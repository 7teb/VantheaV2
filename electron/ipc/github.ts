import { github_service } from "../github/index.ts";
import { emit } from "./handle.ts";

export const register_github_ipc = () => {
  github_service.on_view((root, view) => emit("github:repo_changed", { root, view }));
};
