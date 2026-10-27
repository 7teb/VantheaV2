const secret_names = [
  /^\.env($|\.)/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^secrets\./i,
  /^credentials\./i,
];

const secret_exceptions = new Set([".env.example", ".env.sample"]);

export const windows_name = (part: string) => part.replace(/[. ]+$/, "");

export const is_secret_path = (relative: string): boolean => {
  const normalized = relative.replaceAll("\\", "/").toLowerCase();
  if (normalized === ".git/config" || normalized.endsWith("/.git/config")) {
    return true;
  }
  if (normalized === ".git/hooks" || normalized.startsWith(".git/hooks/") || normalized.includes("/.git/hooks/") || normalized.endsWith("/.git/hooks")) {
    return true;
  }
  return normalized.split("/").some((raw) => {
    const part = windows_name(raw);
    if (part === ".ssh") {
      return true;
    }
    return !secret_exceptions.has(part) && secret_names.some((pattern) => pattern.test(part));
  });
};
