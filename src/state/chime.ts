import type { Chime } from "./chime-rules.ts";

const chimes: Record<Chime, number[]> = {
  finished: [659.25, 987.77],
  attention: [880, 1108.73, 1318.51],
};

const partials: [ratio: number, level: number][] = [
  [1, 1],
  [2, 0.16],
  [3, 0.05],
];

const peak = 0.08;
const attack_s = 0.012;
const decay_s = 0.9;
const spacing_s = 0.12;

let context: AudioContext | null = null;

const note = (audio: AudioContext, frequency: number, start: number) => {
  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + attack_s);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack_s + decay_s);
  envelope.connect(audio.destination);
  for (const [ratio, level] of partials) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency * ratio;
    gain.gain.value = level;
    oscillator.connect(gain).connect(envelope);
    oscillator.start(start);
    oscillator.stop(start + attack_s + decay_s + 0.05);
  }
};

export const play_chime = async (chime: Chime): Promise<void> => {
  context ??= new AudioContext();
  const audio = context;
  if (audio.state === "suspended") {
    await audio.resume();
  }
  const start = audio.currentTime + 0.02;
  chimes[chime].forEach((frequency, index) => note(audio, frequency, start + index * spacing_s));
};
