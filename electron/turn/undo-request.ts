import type { FileChange } from "../../shared/file-changes.ts";

const file_line = (change: FileChange): string => `- ${change.path} (${change.created ? "created in that turn" : "edited"})`;

export const undo_request_text = (changes: FileChange[]): string =>
  [
    "Undo the changes you made in your previous turn. The files that turn changed with write_file or replace_in_file:",
    ...changes.map(file_line),
    "Put every edited file back to its content from before that turn and delete the files that turn created. If that turn also changed files or state through commands, undo that as well. If you cannot recover the earlier content of a file exactly, say so instead of guessing. Change nothing else, then say what you reverted.",
  ].join("\n");
