const commands = new Set("access adduser audit bugs cache ci completion config dedupe deprecate diff dist-tag docs doctor edit exec explain explore find-dupes fund get help help-search init install install-ci-test install-test link ll login logout ls org outdated owner pack ping pkg prefix profile prune publish query rebuild repo restart root run sbom search set shrinkwrap star stars start stop team test token undeprecate uninstall unpublish unstar update version view whoami".split(" "));

const aliases: Record<string, string> = {
  author: "owner", home: "docs", issues: "bugs", info: "view", show: "view", find: "search", add: "install",
  unlink: "uninstall", remove: "uninstall", rm: "uninstall", r: "uninstall", un: "uninstall", rb: "rebuild",
  list: "ls", ln: "link", create: "init", i: "install", it: "install-test", cit: "install-ci-test", up: "update",
  c: "config", s: "search", se: "search", tst: "test", t: "test", ddp: "dedupe", v: "view",
  "run-script": "run", "clean-install": "ci", "clean-install-test": "install-ci-test", x: "exec", why: "explain",
  la: "ll", verison: "version", ic: "ci", innit: "init", in: "install", ins: "install", inst: "install",
  insta: "install", instal: "install", isnt: "install", isnta: "install", isntal: "install", isntall: "install",
  "install-clean": "ci", "isntall-clean": "ci", hlep: "help", "dist-tags": "dist-tag", upgrade: "update",
  udpate: "update", rum: "run", sit: "install-ci-test", urn: "run", ogr: "org", "add-user": "adduser",
};

const names = [...commands, ...Object.keys(aliases)];

export const npm_command = (raw: string): string => {
  const name = raw.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());
  if (commands.has(name)) return name;
  if (Object.hasOwn(aliases, name)) return aliases[name] ?? name;
  if (!name) return "";
  const matching = names.filter((entry) => entry.startsWith(name));
  if (matching.length !== 1) return name;
  const found = matching[0] ?? name;
  return Object.hasOwn(aliases, found) ? aliases[found] ?? found : found;
};
