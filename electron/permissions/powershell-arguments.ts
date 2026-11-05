export type PowershellEntry = { kind: "command" | "encoded" | "file"; at: number };

const windows_values = ["executionpolicy", "windowstyle", "inputformat", "outputformat", "configurationname", "version", "psconsolefile", "ep", "if", "of"];

const core_values = ["executionpolicy", "windowstyle", "inputformat", "outputformat", "configurationname", "configurationfile", "workingdirectory", "settingsfile", "custompipename", "ep", "wd", "if", "of"];

export const powershell_switch = (raw: string): string => /^[-/\u2013\u2014\u2015](\w+):?$/.exec(raw)?.[1]?.toLowerCase() ?? "";

export const powershell_takes_value = (name: string, exe = "powershell"): boolean => (exe === "powershell" ? windows_values : core_values).some((value) => value.startsWith(name));

export const powershell_entry = (exe: string, args: readonly string[]): PowershellEntry | null => {
  for (let index = 0; index < args.length; index += 1) {
    const flag = powershell_switch(args[index] ?? "");
    if (!flag) return { kind: exe === "powershell" ? "command" : "file", at: index };
    if ("file".startsWith(flag)) return { kind: "file", at: index + 1 };
    if ("command".startsWith(flag)) return { kind: "command", at: index + 1 };
    if (flag === "ec" || "encodedcommand".startsWith(flag)) return { kind: "encoded", at: index + 1 };
    if (powershell_takes_value(flag, exe)) {
      index += 1;
    }
  }
  return null;
};
