const aliases: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  "c++": "cpp",
  cs: "csharp",
  rs: "rust",
  golang: "go",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  ps: "powershell",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  kt: "kotlin",
  text: "plaintext",
  txt: "plaintext",
  console: "shell",
  terminal: "shell",
  toml: "ini",
};

const extensions: Record<string, string> = {
  psm1: "powershell",
  psd1: "powershell",
  xaml: "xml",
  csproj: "xml",
  vcxproj: "xml",
  props: "xml",
  targets: "xml",
  mdx: "markdown",
  cfg: "ini",
  conf: "ini",
};

export const language_name = (raw: string) => {
  const key = raw.toLowerCase();
  return aliases[key] ?? key;
};

export const file_language = (file: string): string => {
  const name = file.slice(file.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (name === ".env" || name.startsWith(".env.")) {
    return "ini";
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  const extension = name.slice(dot + 1);
  return extensions[extension] ?? language_name(extension);
};

export const highlightable = (language: string) => language !== "" && language !== "plaintext";
