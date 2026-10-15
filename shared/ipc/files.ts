import { emit, invoke } from "./channel.ts";

export type FilesScope = { chat_id: string | null; project_path: string };

export type FilesRoot = { path: string; name: string; kind: "project" | "workspace" };

export type DirEntry = { name: string; path: string; kind: "file" | "dir" };

export type DirListing = { path: string; entries: DirEntry[]; more: number };

export type FileView =
  | { kind: "text"; path: string; size: number; text: string; truncated: boolean }
  | { kind: "binary"; path: string; size: number }
  | { kind: "missing"; path: string };

export type FileMatches = { paths: string[]; truncated: boolean };

export type FilesChange = { root: string; paths: string[]; overflow: boolean };

export const max_view_bytes = 1024 * 1024;

export const files_channels = {
  "files:root": invoke<[scope: FilesScope], FilesRoot | null>(),
  "files:list": invoke<[scope: FilesScope, path: string], DirListing>(),
  "files:read": invoke<[scope: FilesScope, path: string], FileView>(),
  "files:find": invoke<[scope: FilesScope, query: string], FileMatches>(),
  "files:reveal": invoke<[scope: FilesScope, path: string], void>(),
  "files:watch": invoke<[scope: FilesScope], void>(),
  "files:unwatch": invoke<[], void>(),
  "files:changed": emit<FilesChange>(),
} as const;
