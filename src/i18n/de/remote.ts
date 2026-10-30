import type { remote as en } from "../en/remote.ts";

export const remote: Record<keyof typeof en, string> = {
  "remote.title": "Handyzugriff",
  "remote.toggle": "Handyzugriff im lokalen Netzwerk",
  "remote.scan": "Mit einem Handy im selben WLAN scannen",
  "remote.address": "Adresse",
  "remote.connected_none": "Kein Gerät verbunden",
  "remote.connected_one": "1 Gerät verbunden",
  "remote.connected_other": "{n} Geräte verbunden",
  "remote.new_link": "Neuer Link",
  "remote.new_link_hint": "Erstellt einen neuen QR-Code und entkoppelt alle Geräte",
  "remote.firewall_hint": "Wenn Windows fragt, VantheaX in privaten Netzwerken zulassen",
  "remote.failed_no_network": "Kein lokales Netzwerk gefunden",
  "remote.failed_no_port": "Kein freier Port gefunden",
  "remote.failed_secret_storage": "Sicherer Speicher nicht verfügbar, der Kopplungsschlüssel kann nicht gespeichert werden",
  "remote.failed": "Start fehlgeschlagen: {detail}",
  "remote.connecting": "Verbinde mit dem PC",
  "remote.offline": "Keine Verbindung zum PC",
};
