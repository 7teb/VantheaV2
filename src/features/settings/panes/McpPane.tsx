import { useEffect, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { load_mcp, mcp_store } from "../../../state/extensions.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { McpAddDialog } from "./McpAddDialog.tsx";
import { McpServerCard } from "./McpServerCard.tsx";
import { ListSkeleton } from "./PaneSkeleton.tsx";
import "./mcp.css";
import "./panes.css";

export const McpPane = () => {
  const t = use_t();
  const status = use_store(mcp_store, (state) => state.status);
  const servers = use_store(mcp_store, (state) => state.items);
  const [adding, set_adding] = useState(false);

  useEffect(() => {
    void load_mcp();
  }, []);

  const list = () => {
    if (status === "loading") {
      return (
        <SettingsGroup>
          <ListSkeleton rows={[46, 58]} />
        </SettingsGroup>
      );
    }
    if (status === "failed") {
      return <p className="pane-note">{t("mcp.load_failed")}</p>;
    }
    if (servers.length === 0) {
      return <p className="pane-note">{t("mcp.empty")}</p>;
    }
    return servers.map((server) => <McpServerCard key={server.name} server={server} />);
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("mcp.add")} hint={t("mcp.add_sub")}>
          <Button icon={<PlusIcon size={15} />} onClick={() => set_adding(true)}>
            {t("mcp.add")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      {list()}
      <McpAddDialog open={adding} existing={servers.map((server) => server.name)} on_close={() => set_adding(false)} />
    </>
  );
};
