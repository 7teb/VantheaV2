import { useState } from "react";
import type { McpTier } from "../../../../shared/approval.ts";
import type { McpServerStatus, McpToolStatus } from "../../../../shared/ipc/extensions.ts";
import { Select, type SelectOption } from "../../../components/Select.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t, type MessageKey } from "../../../i18n/index.ts";
import { set_mcp_tool } from "../../../state/extensions.ts";
import { ipc_error_text } from "./ipc-error.ts";

const tier_labels: Record<McpTier, MessageKey> = {
  readonly: "mcp.tier_readonly",
  state_change: "mcp.tier_state_change",
  dangerous: "mcp.tier_dangerous",
  shell_system: "mcp.tier_shell_system",
};

const tiers = Object.keys(tier_labels) as McpTier[];

const detected = "detected";

type TierChoice = McpTier | typeof detected;

const ToolRow = ({ server, tool, on_error }: { server: string; tool: McpToolStatus; on_error: (text: string) => void }) => {
  const t = use_t();
  const options: SelectOption<TierChoice>[] = tiers.map((tier) => ({ id: tier, label: t(tier_labels[tier]) }));
  if (tool.overridden) {
    options.push({ id: detected, label: t("mcp.tier_detected") });
  }

  const apply = async (patch: { risk?: McpTier | null; enabled?: boolean }) => {
    try {
      await set_mcp_tool(server, tool.name, patch);
    } catch (failure) {
      console.error(`[settings] mcp:set_tool failed for ${server}/${tool.name}`, patch, failure);
      on_error(ipc_error_text(failure));
    }
  };

  return (
    <div className="mcp-tool" data-enabled={tool.enabled}>
      <div className="mcp-tool-text">
        <div className="mcp-tool-name">{tool.name}</div>
        {tool.description && (
          <div className="mcp-tool-description" title={tool.description}>
            {tool.description}
          </div>
        )}
      </div>
      <Select
        variant="ghost"
        className="mcp-tool-tier"
        options={options}
        value={tool.tier}
        label={t("mcp.tool_tier", { x: tool.name })}
        on_change={(choice) => void apply({ risk: choice === detected ? null : choice })}
      />
      <Toggle checked={tool.enabled} label={t("mcp.tool_enabled", { x: tool.name })} on_change={(enabled) => void apply({ enabled })} />
    </div>
  );
};

export const McpToolList = ({ server }: { server: McpServerStatus }) => {
  const t = use_t();
  const [error, set_error] = useState<string | null>(null);

  if (server.tools.length === 0) {
    return <p className="pane-note">{t("mcp.no_tools")}</p>;
  }

  return (
    <div className="mcp-tools">
      {server.tools.map((tool) => (
        <ToolRow key={tool.name} server={server.name} tool={tool} on_error={set_error} />
      ))}
      {error && <div className="pane-item-error">{error}</div>}
    </div>
  );
};
