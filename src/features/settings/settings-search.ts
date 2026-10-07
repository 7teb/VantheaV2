import type { MessageKey, Translate } from "../../i18n/translate.ts";

export type SearchableSection = { id: string; label: MessageKey; keywords: MessageKey[] };

export const filter_sections = <S extends SearchableSection>(sections: S[], query: string, t: Translate): S[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") {
    return sections;
  }
  return sections.filter((section) => [section.label, ...section.keywords].some((key) => t(key).toLocaleLowerCase().includes(needle)));
};
