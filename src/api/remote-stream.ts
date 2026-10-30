import { decode_wire, events_path, stream_control, type StreamFrame } from "../../shared/remote-wire.ts";

export type ConnectionState = "connecting" | "live" | "offline";

type FrameListener = (payload: unknown) => void;

type ConnectionListener = (state: ConnectionState) => void;

export type RemoteStream = { ready: () => Promise<void>; on: (name: string, listener: FrameListener) => () => void };

const watchdog_ms = 45_000;

const connection_listeners = new Set<ConnectionListener>();

let connection: ConnectionState = "connecting";

const set_connection = (next: ConnectionState) => {
  if (next === connection) {
    return;
  }
  connection = next;
  for (const listener of [...connection_listeners]) {
    listener(next);
  }
};

export const connection_state = () => connection;

export const on_connection = (listener: ConnectionListener): (() => void) => {
  connection_listeners.add(listener);
  return () => {
    connection_listeners.delete(listener);
  };
};

const read_frame = (data: string): StreamFrame | null => {
  try {
    const frame = decode_wire(data);
    if (typeof frame === "object" && frame !== null && typeof (frame as { n?: unknown }).n === "string") {
      return frame as StreamFrame;
    }
    console.error(`[remote] dropping an event frame without a name: ${data.slice(0, 200)}`);
    return null;
  } catch (error) {
    console.error(`[remote] dropping an unreadable event frame: ${data.slice(0, 200)}`, error);
    return null;
  }
};

const boot_of = (payload: unknown): string | null => {
  const boot = typeof payload === "object" && payload !== null ? (payload as { boot?: unknown }).boot : undefined;
  return typeof boot === "string" ? boot : null;
};

export const create_remote_stream = (client_id: string): RemoteStream => {
  const listeners = new Map<string, Set<FrameListener>>();
  let source: EventSource | null = null;
  let last_id = "";
  let boot: string | null = null;
  let last_frame_at = 0;
  let watchdog: number | undefined;
  let open_ready = () => {};
  const ready = new Promise<void>((resolve) => {
    open_ready = resolve;
  });
  set_connection("connecting");

  const dispatch = (frame: StreamFrame) => {
    for (const listener of [...(listeners.get(frame.n) ?? [])]) {
      try {
        listener(frame.p);
      } catch (error) {
        console.error(`[remote] a listener for ${frame.n} failed`, error);
      }
    }
  };

  const on_hello = (payload: unknown) => {
    const next = boot_of(payload);
    if (boot !== null && next !== boot) {
      location.reload();
      return;
    }
    boot = next;
    set_connection("live");
    open_ready();
  };

  const on_frame = (event: MessageEvent<string>) => {
    last_frame_at = Date.now();
    arm_watchdog(watchdog_ms);
    if (event.lastEventId) {
      last_id = event.lastEventId;
    }
    const frame = read_frame(event.data);
    if (!frame) {
      return;
    }
    if (frame.n === stream_control.hello) {
      on_hello(frame.p);
      return;
    }
    if (frame.n === stream_control.resync) {
      location.reload();
      return;
    }
    if (frame.n !== stream_control.ping) {
      dispatch(frame);
    }
  };

  const open = () => {
    const query = new URLSearchParams({ client: client_id });
    if (last_id) {
      query.set("last", last_id);
    }
    const next = new EventSource(`${events_path}?${query}`);
    next.onmessage = on_frame;
    next.onerror = () => {
      if (next.readyState !== EventSource.CLOSED) {
        set_connection("offline");
        return;
      }
      if (boot !== null) {
        location.reload();
        return;
      }
      console.error(`[remote] ${events_path} refused the stream before its first hello`);
      set_connection("offline");
    };
    source = next;
    last_frame_at = Date.now();
    arm_watchdog(watchdog_ms);
  };

  const check_silence = () => {
    const quiet = Date.now() - last_frame_at;
    if (quiet < watchdog_ms) {
      arm_watchdog(watchdog_ms - quiet);
      return;
    }
    if (document.visibilityState !== "visible") {
      return;
    }
    source?.close();
    set_connection("connecting");
    open();
  };

  const arm_watchdog = (delay_ms: number) => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(check_silence, delay_ms);
  };

  const on_visibility = () => {
    if (document.visibilityState === "visible") {
      check_silence();
    }
  };

  const start = () => {
    if (source) {
      return;
    }
    document.addEventListener("visibilitychange", on_visibility);
    open();
  };

  return {
    ready: () => {
      start();
      return ready;
    },
    on: (name, listener) => {
      start();
      const set = listeners.get(name) ?? new Set<FrameListener>();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
  };
};
