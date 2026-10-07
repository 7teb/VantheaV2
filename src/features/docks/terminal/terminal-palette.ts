import type { ITheme } from "@xterm/xterm";

export type TerminalLook = { theme: ITheme; font_family: string };

const css_var = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

let look: TerminalLook | null = null;

export const terminal_look = (): TerminalLook => {
  if (look) {
    return look;
  }
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => css_var(style, name);
  const background = read("--surface-inset");
  look = {
    font_family: read("--font-mono"),
    theme: {
      background,
      foreground: read("--text-code"),
      cursor: read("--text-primary"),
      cursorAccent: background,
      selectionBackground: read("--selection"),
      scrollbarSliderBackground: read("--scrollbar"),
      scrollbarSliderHoverBackground: read("--scrollbar-hover"),
      scrollbarSliderActiveBackground: read("--scrollbar-hover"),
      black: read("--terminal-black"),
      red: read("--terminal-red"),
      green: read("--terminal-green"),
      yellow: read("--terminal-yellow"),
      blue: read("--terminal-blue"),
      magenta: read("--terminal-magenta"),
      cyan: read("--terminal-cyan"),
      white: read("--terminal-white"),
      brightBlack: read("--terminal-bright-black"),
      brightRed: read("--terminal-bright-red"),
      brightGreen: read("--terminal-bright-green"),
      brightYellow: read("--terminal-bright-yellow"),
      brightBlue: read("--terminal-bright-blue"),
      brightMagenta: read("--terminal-bright-magenta"),
      brightCyan: read("--terminal-bright-cyan"),
      brightWhite: read("--terminal-bright-white"),
    },
  };
  return look;
};

let fonts: Promise<void> | null = null;

export const terminal_fonts_ready = (): Promise<void> => {
  fonts ??= document.fonts
    .load(`13px ${terminal_look().font_family}`)
    .then(() => undefined)
    .catch((error: unknown) => console.error(`[terminal] loading the font ${terminal_look().font_family} failed`, error));
  return fonts;
};
