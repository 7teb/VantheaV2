export type ShellKind = "powershell" | "bash";

export const shell_kinds: readonly ShellKind[] = ["powershell", "bash"];

export const shell_labels: Record<ShellKind, string> = { powershell: "PowerShell", bash: "Git Bash" };

export const shell_run_tools: Record<ShellKind, string> = { powershell: "run_command", bash: "run_bash" };

export const command_tools: readonly string[] = [shell_run_tools.powershell, shell_run_tools.bash, "start_background_task"];

export const is_shell_run = (name: string): boolean => name === shell_run_tools.powershell || name === shell_run_tools.bash;

export const call_shell = (name: string, args: Record<string, unknown>): ShellKind =>
  name === shell_run_tools.bash || (name === "start_background_task" && args.shell === "bash") ? "bash" : "powershell";
