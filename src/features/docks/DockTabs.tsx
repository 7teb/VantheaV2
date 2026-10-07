import { IconButton } from "../../components/Button.tsx";
import { CloseIcon } from "../../components/icons.tsx";

export type DockTabEntry = { id: string; label: string; busy?: boolean };

type DockTabsProps = {
  tabs: DockTabEntry[];
  active_id: string | null;
  label: string;
  close_label: string;
  on_select: (id: string) => void;
  on_close: (id: string) => void;
};

export const DockTabs = ({ tabs, active_id, label, close_label, on_select, on_close }: DockTabsProps) => (
  <div className="dock-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => {
      const active = tab.id === active_id;
      return (
        <div key={tab.id} className="dock-tab" data-active={active}>
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className="dock-tab-button"
            title={tab.label}
            onClick={() => on_select(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                on_close(tab.id);
              }
            }}
          >
            {tab.busy && <span className="dock-tab-busy" aria-hidden="true" />}
            <span className="dock-tab-label">{tab.label}</span>
          </button>
          <IconButton label={close_label} size="sm" tooltip={false} className="dock-tab-close" onClick={() => on_close(tab.id)}>
            <CloseIcon size={12} />
          </IconButton>
        </div>
      );
    })}
  </div>
);
