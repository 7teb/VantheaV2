import type { Language } from "../../shared/settings.ts";
import { agent_name } from "./endpoints.ts";

const texts: Record<Language, { received: string; failed: string }> = {
  en: { received: "Sign-in received. Return to VantheaX.", failed: "Sign-in was not completed. Return to VantheaX." },
  de: { received: "Anmeldung empfangen. Kehre zu VantheaX zurück.", failed: "Die Anmeldung wurde nicht abgeschlossen. Kehre zu VantheaX zurück." },
};

export const callback_page = (language: Language, received: boolean): string => {
  const text = received ? texts[language].received : texts[language].failed;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${agent_name}</title></head><body><p>${text}</p></body></html>`;
};
