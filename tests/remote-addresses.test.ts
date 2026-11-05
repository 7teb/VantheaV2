import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import { test } from "node:test";
import { is_private_ipv4, primary_first, private_ipv4_links } from "../electron/remote/addresses.ts";

test("only the three private IPv4 ranges count as LAN addresses", () => {
  const allowed = ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.178.24"];
  const refused = [
    "127.0.0.1",
    "127.1.2.3",
    "169.254.10.20",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "8.8.8.8",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "192.168.1",
    "192.168.1.1.1",
    "192.168.01.1",
    "192.168.1.256",
    "10.0.0.-1",
    "::1",
    "fe80::1",
    "",
  ];
  for (const address of allowed) {
    assert.equal(is_private_ipv4(address), true, address);
  }
  for (const address of refused) {
    assert.equal(is_private_ipv4(address), false, address);
  }
});

const entry = (address: string, family: "IPv4" | "IPv6", internal = false) =>
  ({ address, family, internal, netmask: "", mac: "00:00:00:00:00:00", cidr: null, scopeid: 0 }) as NetworkInterfaceInfo;

test("the link list skips loopback, link-local, public and IPv6 entries and keeps interface order", () => {
  const links = private_ipv4_links({
    "Loopback Pseudo-Interface 1": [entry("127.0.0.1", "IPv4", true), entry("::1", "IPv6", true)],
    Ethernet: [entry("fe80::1", "IPv6"), entry("192.168.1.20", "IPv4"), entry("169.254.3.4", "IPv4")],
    "Wi-Fi": [entry("10.0.0.7", "IPv4"), entry("192.168.1.20", "IPv4")],
    Public: [entry("85.10.20.30", "IPv4")],
    Docker: [entry("172.17.0.1", "IPv4")],
  });
  assert.deepEqual(links, [
    { interface: "Ethernet", address: "192.168.1.20" },
    { interface: "Wi-Fi", address: "10.0.0.7" },
    { interface: "Docker", address: "172.17.0.1" },
  ]);
  assert.deepEqual(private_ipv4_links({ Loopback: [entry("127.0.0.1", "IPv4", true)] }), []);
  assert.deepEqual(private_ipv4_links({ Odd: [entry("192.168.5.5", "IPv4", true)] }), []);
});

test("the primary address moves to the front and the rest keep their order", () => {
  const links = [
    { interface: "a", address: "10.0.0.1" },
    { interface: "b", address: "192.168.1.2" },
    { interface: "c", address: "172.16.0.3" },
  ];
  assert.deepEqual(
    primary_first(links, "172.16.0.3").map((link) => link.interface),
    ["c", "a", "b"],
  );
  assert.equal(primary_first(links, null), links);
  assert.equal(primary_first(links, "8.8.8.8"), links);
});
