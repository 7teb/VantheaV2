import dgram from "node:dgram";
import os from "node:os";

export type LanAddress = { interface: string; address: string };

const octet = /^(0|[1-9]\d{0,2})$/;

export const is_private_ipv4 = (address: string): boolean => {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((part) => octet.test(part) && Number(part) <= 255)) {
    return false;
  }
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

export const private_ipv4_links = (interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanAddress[] => {
  const links: LanAddress[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !is_private_ipv4(entry.address) || links.some((link) => link.address === entry.address)) {
        continue;
      }
      links.push({ interface: name, address: entry.address });
    }
  }
  return links;
};

export const primary_ipv4 = (): Promise<string | null> =>
  new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (address: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch (error) {
        console.error("[remote] closing the address lookup socket failed:", error);
      }
      resolve(address);
    };
    socket.once("error", (error) => {
      console.error("[remote] looking up the primary LAN address failed:", error);
      finish(null);
    });
    socket.connect(9, "192.0.2.1", () => {
      try {
        finish(socket.address().address);
      } catch (error) {
        console.error("[remote] reading the primary LAN address failed:", error);
        finish(null);
      }
    });
  });

export const primary_first = (links: LanAddress[], primary: string | null): LanAddress[] => {
  const index = links.findIndex((link) => link.address === primary);
  return index <= 0 ? links : [links[index], ...links.slice(0, index), ...links.slice(index + 1)];
};
