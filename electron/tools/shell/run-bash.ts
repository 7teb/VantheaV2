import { shell_run_tools } from "../../../shared/shell.ts";
import { git_bash_path } from "../../shell/git-bash.ts";
import { define_tool } from "../types.ts";
import { default_timeout_ms, parse_run, run_in_shell, run_parameters, type RunArgs } from "./run-command.ts";

export const run_bash_tool = define_tool<RunArgs>({
  spec: {
    name: shell_run_tools.bash,
    description:
      `Run a command with Git Bash (bash -c from Git for Windows) in the project folder and return its combined output and exit code. Write POSIX shell syntax (&&, |, $(...), single quotes) and do not wrap it in bash -c or another shell. Use /c/Users/... or C:/Users/... for Windows paths; a backslash is an escape character in bash. Git Bash rewrites arguments that start with a slash before they reach a Windows program, so double the slash of such switches (cmd //c, taskkill //F //PID 1234). stderr is already captured with stdout. It runs headless without a terminal and must exit on its own. The default timeout is ${default_timeout_ms / 1000} s; for builds, tests or installs set timeout_ms up front.`,
    parameters: run_parameters,
  },
  profiles: ["main", "plan", "worker"],
  available: () => git_bash_path() !== null,
  parse: parse_run,
  run: (ctx, args) => run_in_shell(ctx, args, "bash"),
});
