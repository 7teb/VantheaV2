import path from "node:path";
import { git_bash_root } from "../shell/git-bash.ts";

export type MsysPath =
  | { kind: "windows"; path: string }
  | { kind: "msys_root"; rest: string }
  | { kind: "relative"; token: string };

const drive = /^\/(?:cygdrive\/)?([a-zA-Z])(?=\/|$)/;

const home_prefix = /^~(?=$|[\\/])/;

const windows_drive = /^[a-zA-Z]:(?:[\\/]|$)/;

export const expand_home = (token: string, home: string | null): string =>
  home ? token.replace(home_prefix, home.replace(/[\\/]+$/, "")) : token;

export const msys_translate = (token: string, home: string | null): MsysPath => {
  const expanded = expand_home(token.trim(), home);
  const value = expanded.startsWith("/") ? path.posix.normalize(expanded) : expanded;
  const as_drive = drive.exec(value);
  if (as_drive) {
    const letter = (as_drive[1] ?? "").toUpperCase();
    const rest = value.slice(as_drive[0].length);
    return { kind: "windows", path: path.win32.resolve(`${letter}:${rest || "\\"}`) };
  }
  if (windows_drive.test(value)) {
    return { kind: "windows", path: path.win32.resolve(value) };
  }
  if (value.startsWith("/")) {
    return { kind: "msys_root", rest: value };
  }
  return { kind: "relative", token: value };
};

export const msys_resolve = (location: string, token: string): MsysPath => {
  if (location.startsWith("/")) {
    return msys_translate(path.posix.resolve(location, token), null);
  }
  const on_drive = /^([a-zA-Z]):(.*)$/.exec(location);
  if (!on_drive) {
    return { kind: "windows", path: path.win32.resolve(location, token) };
  }
  const letter = (on_drive[1] ?? "").toLowerCase();
  return msys_translate(path.posix.resolve(`/${letter}${(on_drive[2] ?? "").replace(/\\/g, "/")}`, token), null);
};

export const is_msys_root_target = (rest: string): boolean => /^\/\*?$/.test(rest.replace(/[\\/]+$/, "") || "/");

export type MsysMounts = { root: string | null; home: string | null; temp: string | null };

export const msys_mounts = (): MsysMounts => ({
  root: git_bash_root(),
  home: process.env.HOME || process.env.USERPROFILE || null,
  temp: process.env.TEMP || process.env.TMP || null,
});

export const msys_native = (token: string, mounts: MsysMounts): string | null => {
  if (/^\/\/[^/]+\/./.test(token)) {
    return token.replace(/\//g, "\\");
  }
  if (token.startsWith("//")) {
    return null;
  }
  const translated = msys_translate(token, mounts.home);
  if (translated.kind === "windows") {
    return translated.path;
  }
  if (translated.kind === "relative") {
    return translated.token;
  }
  if (/^\/tmp(?:\/|$)/i.test(translated.rest)) {
    return mounts.temp ? path.win32.join(mounts.temp, translated.rest.slice(4)) : null;
  }
  if (/^\/(?:dev|proc)(?:\/|$)/i.test(translated.rest)) {
    return null;
  }
  return mounts.root ? path.win32.join(mounts.root, translated.rest) : null;
};
