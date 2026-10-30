import { api } from "../api/bridge.ts";
import { ipc_error_text } from "../features/settings/panes/ipc-error.ts";
import { t } from "../i18n/index.ts";
import { set_composer_error } from "./composer.ts";
import { create_store } from "./create-store.ts";

export type DictationState = { draft_key: string; phase: "starting" | "recording" | "transcribing" } | null;

type Session = { recorder: MediaRecorder; stream: MediaStream; context: AudioContext; analyser: AnalyserNode; done: Promise<Blob>; started_at: number };

const shortest_ms = 250;

const recording_mime = "audio/webm;codecs=opus";

export const dictation_store = create_store<DictationState>(null);

let session: Session | null = null;

let attempt = 0;

export const dictation_supported = () =>
  typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder === "function" && MediaRecorder.isTypeSupported(recording_mime);

export const dictation_analyser = (): AnalyserNode | null => session?.analyser ?? null;

const microphone_error = (error: unknown): string => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return t("dictation.denied");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return t("dictation.no_microphone");
  }
  if (name === "NotReadableError") {
    return t("dictation.microphone_busy");
  }
  return t("dictation.microphone_failed", { error: ipc_error_text(error) });
};

const release = (current: Session) => {
  current.stream.getTracks().forEach((track) => track.stop());
  current.context.close().catch((error: unknown) => console.warn("[dictation] closing the audio context failed", error));
};

const open_session = (stream: MediaStream): Session => {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  context.createMediaStreamSource(stream).connect(analyser);
  const recorder = new MediaRecorder(stream, { mimeType: recording_mime, audioBitsPerSecond: 32000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  recorder.start();
  return { recorder, stream, context, analyser, done, started_at: performance.now() };
};

export const start_dictation = async (draft_key: string) => {
  if (dictation_store.get() !== null) {
    return;
  }
  const ticket = ++attempt;
  dictation_store.set({ draft_key, phase: "starting" });
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (ticket !== attempt) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    session = open_session(stream);
    dictation_store.set({ draft_key, phase: "recording" });
  } catch (error) {
    console.error(`[dictation] opening the microphone for draft ${draft_key} failed`, error);
    stream?.getTracks().forEach((track) => track.stop());
    if (ticket !== attempt) {
      return;
    }
    dictation_store.set(null);
    set_composer_error(draft_key, microphone_error(error));
  }
};

export const cancel_dictation = () => {
  const state = dictation_store.get();
  if (state === null || state.phase === "transcribing") {
    return;
  }
  attempt += 1;
  const current = session;
  session = null;
  dictation_store.set(null);
  if (current) {
    current.recorder.stop();
    release(current);
  }
};

export const finish_dictation = async (): Promise<string | null> => {
  const state = dictation_store.get();
  const current = session;
  if (state?.phase !== "recording" || !current) {
    return null;
  }
  session = null;
  current.recorder.stop();
  if (performance.now() - current.started_at < shortest_ms) {
    release(current);
    dictation_store.set(null);
    return null;
  }
  dictation_store.set({ ...state, phase: "transcribing" });
  const recording = await current.done;
  release(current);
  try {
    const text = await api.invoke("dictation:transcribe", new Uint8Array(await recording.arrayBuffer()));
    if (text === "") {
      set_composer_error(state.draft_key, t("dictation.nothing_heard"));
      return null;
    }
    return text;
  } catch (error) {
    console.error(`[dictation] transcribing the recording for draft ${state.draft_key} failed`, error);
    set_composer_error(state.draft_key, t("dictation.failed", { error: ipc_error_text(error) }));
    return null;
  } finally {
    dictation_store.set(null);
  }
};
