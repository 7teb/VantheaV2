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
  create: (owner: string | null, options: PtyOptions) => string;
  input: (terminal_id: string, data: string) => void;
  resize: (terminal_id: string, cols: number, rows: number) => void;
  adopt: (terminal_id: string, owner: string) => void;
  close: (terminal_id: string) => void;
  close_owner: (owner: string) => void;
  close_all: () => void;
  ids: () => string[];
};

type Session = { pty: PtyProcess; owner: string | null };

export const terminal_limits = { min_cols: 2, max_cols: 1000, min_rows: 1, max_rows: 500 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export const clamp_cols = (cols: number) => clamp(cols, terminal_limits.min_cols, terminal_limits.max_cols);

export const clamp_rows = (rows: number) => clamp(rows, terminal_limits.min_rows, terminal_limits.max_rows);

export const create_terminal_registry = (spawn_pty: PtyFactory, sink: TerminalSink, next_id: () => string): TerminalRegistry => {
  const sessions = new Map<string, Session>();

  const kill = (terminal_id: string, pty: PtyProcess) => {
    try {
      pty.kill();
    } catch (error) {
      console.warn(`[terminal] killing ${terminal_id} failed:`, error);
    }
  };

  const create = (owner: string | null, options: PtyOptions) => {
    const terminal_id = next_id();
    const pty = spawn_pty({ cwd: options.cwd, cols: clamp_cols(options.cols), rows: clamp_rows(options.rows) });
    const session: Session = { pty, owner };
    sessions.set(terminal_id, session);
    pty.on_data((data) => {
      if (sessions.get(terminal_id) === session) {
        sink.data(terminal_id, data);
      }
    });
    pty.on_exit((exit_code) => {
      if (sessions.get(terminal_id) !== session) {
        return;
      }
      sessions.delete(terminal_id);
      sink.exit(terminal_id, exit_code);
    });
    return terminal_id;
  };

  const adopt = (terminal_id: string, owner: string) => {
    const session = sessions.get(terminal_id);
    if (!session || session.owner === owner) {
      return;
    }
    if (session.owner !== null) {
      throw new Error(`terminal ${terminal_id} belongs to chat ${session.owner}, chat ${owner} cannot take it over`);
    }
    session.owner = owner;
  };

  const close = (terminal_id: string) => {
    const session = sessions.get(terminal_id);
    if (!session) {
      return;
    }
    sessions.delete(terminal_id);
    kill(terminal_id, session.pty);
  };

  const close_matching = (matches: (session: Session) => boolean) => {
    for (const [terminal_id, session] of [...sessions]) {
      if (matches(session)) {
        close(terminal_id);
      }
    }
  };

  return {
    create,
    input: (terminal_id, data) => sessions.get(terminal_id)?.pty.write(data),
    resize: (terminal_id, cols, rows) => sessions.get(terminal_id)?.pty.resize(clamp_cols(cols), clamp_rows(rows)),
    adopt,
    close,
    close_owner: (owner) => close_matching((session) => session.owner === owner),
    close_all: () => close_matching(() => true),
    ids: () => [...sessions.keys()],
  };
};
