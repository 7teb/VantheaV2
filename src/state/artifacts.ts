import type { Artifact } from "../../shared/ipc/media.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type ArtifactsState = { project_path: string | null; status: "idle" | "loading" | "ready" | "failed"; list: Artifact[] };

export const artifacts_store = create_store<ArtifactsState>({ project_path: null, status: "idle", list: [] });

let request = 0;

const path_key = (value: string) => value.trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();

const sorted = (list: Artifact[]) =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.created_at) - Date.parse(a.created_at));

export const artifact_url = (artifact_id: string) => `vx-media://image/${encodeURIComponent(artifact_id)}`;

const fetch_artifacts = async (project_path: string, quiet: boolean) => {
  const ticket = ++request;
  if (!quiet) {
    artifacts_store.set({ project_path, status: "loading", list: [] });
  }
  try {
    const list = await api.invoke("artifacts:list", project_path);
    if (ticket === request) {
      artifacts_store.set({ project_path, status: "ready", list: sorted(list) });
    }
  } catch (error) {
    console.error(`[artifacts] artifacts:list failed for project ${project_path}`, error);
    if (ticket === request) {
      artifacts_store.set({ project_path, status: "failed", list: [] });
    }
  }
};

export const load_artifacts = (project_path: string) => {
  const state = artifacts_store.get();
  return fetch_artifacts(project_path, state.project_path === project_path && state.status === "ready");
};

const replace = (artifact: Artifact) =>
  artifacts_store.update((state) => ({ ...state, list: sorted(state.list.map((entry) => (entry.id === artifact.id ? artifact : entry))) }));

export const set_artifact_pinned = async (artifact_id: string, pinned: boolean) => {
  try {
    replace(await api.invoke("artifacts:update", artifact_id, { pinned }));
  } catch (error) {
    console.error(`[artifacts] artifacts:update pinned=${pinned} failed for ${artifact_id}`, error);
  }
};

export const rename_artifact = async (artifact_id: string, title: string) => {
  try {
    replace(await api.invoke("artifacts:update", artifact_id, { title }));
  } catch (error) {
    console.error(`[artifacts] artifacts:update title failed for ${artifact_id}`, error);
  }
};

export const export_artifact = async (artifact_id: string): Promise<boolean> => {
  try {
    return await api.invoke("artifacts:export", artifact_id);
  } catch (error) {
    console.error(`[artifacts] artifacts:export failed for ${artifact_id}`, error);
    return false;
  }
};

export const init_artifacts = (): (() => void) =>
  api.on("artifacts:changed", ({ project_path }) => {
    const current = artifacts_store.get().project_path;
    if (current !== null && path_key(current) === path_key(project_path)) {
      void fetch_artifacts(current, true);
    }
  });
