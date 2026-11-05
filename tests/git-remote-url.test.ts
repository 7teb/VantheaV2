import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_remote_url, strip_userinfo, transport_scheme } from "../shared/git/remote-url.ts";

const shape = (url: string) => {
  const parsed = parse_remote_url(url);
  return [parsed.host, parsed.host_kind, parsed.slug];
};

test("github.com in https, scp and ssh form, with userinfo, port 443 and ssh.github.com", () => {
  assert.deepEqual(shape("https://github.com/7teb/VantheaX.git"), ["github.com", "github", "7teb/VantheaX"]);
  assert.deepEqual(shape("https://x-access-token:ghp_secret@github.com/o/r"), ["github.com", "github", "o/r"]);
  assert.deepEqual(shape("git@github.com:o/r.git"), ["github.com", "github", "o/r"]);
  assert.deepEqual(shape("ssh://git@ssh.github.com:443/o/r.git"), ["ssh.github.com", "github", "o/r"]);
  assert.deepEqual(shape("https://www.github.com/o/r/"), ["www.github.com", "github", "o/r"]);
});

test("GHE.com subdomains are their own host class", () => {
  assert.deepEqual(shape("acme@acme.ghe.com:o/r.git"), ["acme.ghe.com", "ghe_com", "o/r"]);
  assert.deepEqual(shape("https://acme.ghe.com/o/r"), ["acme.ghe.com", "ghe_com", "o/r"]);
});

test("other hosts, GitLab subgroups and ssh aliases are not GitHub", () => {
  assert.deepEqual(shape("https://gitlab.com/g/sub/r.git"), ["gitlab.com", "other", null]);
  assert.deepEqual(shape("git@github-work:o/r.git"), ["github-work", "other", "o/r"]);
  assert.deepEqual(shape("git://example.org/r.git"), ["example.org", "other", null]);
});

test("local paths, drive letters, UNC paths, file urls and remote helpers", () => {
  assert.deepEqual(shape("C:/repos/r"), [null, "local", null]);
  assert.deepEqual(shape("D:\\repos\\r"), [null, "local", null]);
  assert.deepEqual(shape("\\\\server\\share\\r.git"), [null, "local", null]);
  assert.deepEqual(shape("../sibling"), [null, "local", null]);
  assert.deepEqual(shape("file:///C:/repos/r"), [null, "local", null]);
  assert.deepEqual(shape("ext::ssh -i key host %S"), [null, "helper", null]);
  assert.deepEqual(shape("persistent-https::https://example.org/r"), [null, "helper", null]);
});

test("the transport scheme of a helper address is the address's own scheme, else the helper's name", () => {
  assert.equal(transport_scheme("https://github.com/o/r"), "https");
  assert.equal(transport_scheme("git@github.com:o/r.git"), "ssh");
  assert.equal(transport_scheme("C:/repos/r"), null);
  assert.equal(transport_scheme("http::http://127.0.0.1/r.git"), "http");
  assert.equal(transport_scheme("HTTPS::HTTP://host/r"), "http");
  assert.equal(transport_scheme("http::https://host/r"), "https");
  assert.equal(transport_scheme("http::host/r.git"), "http");
  assert.equal(transport_scheme("ext::ssh -i key host %S"), "ext");
  assert.equal(transport_scheme("persistent-https::https://example.org/r"), "https");
});

test("userinfo is stripped from urls and from text that contains them", () => {
  assert.equal(strip_userinfo("https://token@host/x.git"), "https://host/x.git");
  assert.equal(strip_userinfo("https://user:pass@github.com/o/r"), "https://github.com/o/r");
  assert.equal(strip_userinfo("fatal: unable to access 'https://user:tok@github.com/o/r/': error"), "fatal: unable to access 'https://github.com/o/r/': error");
  assert.equal(strip_userinfo("git@github.com:o/r.git"), "git@github.com:o/r.git");
});
