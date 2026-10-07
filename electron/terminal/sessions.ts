export type PtyOptions = { cwd: string; cols: number; rows: number };

export type PtyProcess = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  on_data: (listener: (data: string) => void) => void;
  on_exit: (listener: (exit_code: number) => void) => void;
};

export type PtyFactory = (options: PtyOptions) => PtyProcess;

export type TerminalSink = {
  data: (terminal_id: string, data: string) => void;
  exit: (terminal_id: string, exit_code: number) => void;
};

export type TerminalRegistry = {
  create: (options: PtyOptions) => string;
  input: (terminal_id: string, data: string) => void;
  resize: (terminal_id: string, cols: number, rows: number) => void;
  close: (terminal_id: string) => void;
  close_all: () => void;
  ids: () => string[];
};

export const terminal_limits = { min_cols: 2, max_cols: 1000, min_rows: 1, max_rows: 500 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export const clamp_cols = (cols: number) => clamp(cols, terminal_limits.min_cols, terminal_limits.max_cols);

export const clamp_rows = (rows: number) => clamp(rows, terminal_limits.min_rows, terminal_limits.max_rows);

export const create_terminal_registry = (spawn_pty: PtyFactory, sink: TerminalSink, next_id: () => string): TerminalRegistry => {
  const sessions = new Map<string, PtyProcess>();

  const kill = (terminal_id: string, pty: PtyProcess) => {
    try {
      pty.kill();
    } catch (error) {
      console.warn(`[terminal] killing ${terminal_id} failed:`, error);
    }
  };

  const create = (options: PtyOptions) => {
    const terminal_id = next_id();
    const pty = spawn_pty({ cwd: options.cwd, cols: clamp_cols(options.cols), rows: clamp_rows(options.rows) });
    sessions.set(terminal_id, pty);
    pty.on_data((data) => {
      if (sessions.get(terminal_id) === pty) {
        sink.data(terminal_id, data);
      }
    });
    pty.on_exit((exit_code) => {
      if (sessions.get(terminal_id) !== pty) {
        return;
      }
      sessions.delete(terminal_id);
      sink.exit(terminal_id, exit_code);
    });
    return terminal_id;
  };

  const close = (terminal_id: string) => {
    const pty = sessions.get(terminal_id);
    if (!pty) {
      return;
    }
    sessions.delete(terminal_id);
    kill(terminal_id, pty);
  };

  return {
    create,
    input: (terminal_id, data) => sessions.get(terminal_id)?.write(data),
    resize: (terminal_id, cols, rows) => sessions.get(terminal_id)?.resize(clamp_cols(cols), clamp_rows(rows)),
    close,
    close_all: () => {
      for (const terminal_id of [...sessions.keys()]) {
        close(terminal_id);
      }
    },
    ids: () => [...sessions.keys()],
  };
};
