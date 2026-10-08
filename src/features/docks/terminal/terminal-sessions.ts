import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { t } from "../../../i18n/index.ts";
import { resize_terminal, start_terminal, write_terminal } from "../../../state/terminal.ts";
import { terminal_look } from "./terminal-palette.ts";

type Session = { term: Terminal; fit: FitAddon; host: HTMLDivElement };

const sessions = new Map<string, Session>();

const exit_line = (exit_code: number) => `\r\n\x1b[90m${t("terminal.exited", { code: exit_code })}\x1b[0m\r\n`;

export const fit_session = (tab_id: string) => {
  const session = sessions.get(tab_id);
  if (session?.host.isConnected) {
    session.fit.fit();
  }
};

const create_session = (tab_id: string, container: HTMLElement) => {
  const look = terminal_look();
  const host = document.createElement("div");
  host.className = "terminal-host";
  container.append(host);
  const term = new Terminal({
    fontFamily: look.font_family,
    fontSize: look.font_size,
    lineHeight: 1.2,
    theme: look.theme,
    cursorBlink: true,
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  term.onData((data) => write_terminal(tab_id, data));
  term.onResize(({ cols, rows }) => resize_terminal(tab_id, cols, rows));
  sessions.set(tab_id, { term, fit, host });
  void start_terminal(tab_id, term.cols, term.rows, {
    data: (text) => term.write(text),
    exit: (exit_code) => term.write(exit_line(exit_code)),
  }).then((started) => {
    if (started) {
      resize_terminal(tab_id, term.cols, term.rows);
    }
  });
};

export const attach_session = (tab_id: string, container: HTMLElement) => {
  const session = sessions.get(tab_id);
  if (!session) {
    create_session(tab_id, container);
    return;
  }
  container.append(session.host);
  session.fit.fit();
  session.term.refresh(0, session.term.rows - 1);
};

export const detach_session = (tab_id: string) => {
  sessions.get(tab_id)?.host.remove();
};

export const focus_session = (tab_id: string) => {
  sessions.get(tab_id)?.term.focus();
};

export const dispose_session = (tab_id: string) => {
  const session = sessions.get(tab_id);
  if (!session) {
    return;
  }
  sessions.delete(tab_id);
  session.term.dispose();
  session.host.remove();
};
