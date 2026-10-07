import { useState, type FormEvent } from "react";
import type { SecretName } from "../../../../shared/settings.ts";
import { Button } from "../../../components/Button.tsx";
import { CheckIcon, KeyIcon } from "../../../components/icons.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { use_t } from "../../../i18n/index.ts";
import { set_secret } from "../../../state/settings.ts";
import { SettingsRow } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import "./SecretRow.css";

const masked_key = "•".repeat(18);

type SecretRowProps = { name: SecretName; label: string; stored: boolean; placeholder: string; on_saved?: () => void };

export const SecretRow = ({ name, label, stored, placeholder, on_saved }: SecretRowProps) => {
  const t = use_t();
  const [value, set_value] = useState("");
  const [saving, set_saving] = useState(false);
  const [saved, set_saved] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (key === "" || saving) {
      return;
    }
    set_saving(true);
    set_error(null);
    try {
      await set_secret(name, key);
      set_value("");
      set_saved(true);
      on_saved?.();
    } catch (failure) {
      console.error(`[settings] settings:set_secret failed for ${name}`, failure);
      set_error(`${t("settings.key_failed")}: ${ipc_error_text(failure)}`);
    } finally {
      set_saving(false);
    }
  };

  return (
    <SettingsRow label={label} hint={stored ? t("settings.stored") : t("settings.api_key_sub")} error={error}>
      <form className="key-form" onSubmit={save}>
        <TextField
          className="key-field"
          type="password"
          value={value}
          on_change={(next) => {
            set_value(next);
            set_saved(false);
            set_error(null);
          }}
          icon={<KeyIcon size={15} />}
          placeholder={stored ? masked_key : placeholder}
          aria-label={label}
          autoComplete="off"
        />
        <Button type="submit" disabled={value.trim() === "" || saving} icon={saved ? <CheckIcon size={15} /> : undefined}>
          {saved ? t("settings.key_saved") : t("settings.save_key")}
        </Button>
      </form>
    </SettingsRow>
  );
};
