import type { web as en } from "../en/web.ts";

export const web: Record<keyof typeof en, string> = {
  "web.enable": "Websuche aktivieren",
  "web.key": "Tavily-API-Key",
  "web.results": "Treffer pro Suche",
  "web.depth": "Suchtiefe",
  "web.depth_basic": "Basic",
  "web.depth_advanced": "Advanced",
  "web.topic": "Thema",
  "web.topic_general": "Allgemein",
  "web.topic_news": "News",
  "web.sources": "Quellen",
  "web.searching_web": "Sucht im Web",
  "web.checking_site": "{site} wird durchsucht",
  "web.searched_site": "{site} durchsucht",
  "web.searched_sites": "{n} Websites durchsucht",
  "web.searched_web": "Web durchsucht",
  "web.depth_sub": "Advanced kostet mehr Tavily-Credits",
  "web.enable_sub": "Das Modell kann über Tavily im Web suchen",
  "web.key_placeholder": "tvly-...",
};
