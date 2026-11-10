import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { t } from "@/lib/i18n";
import { isOwnerOrAdmin, readSessionState, type SessionState } from "@/lib/session";
import { api, useStore, type Bot, type BotAnnouncement } from "@/state/store";
import type { ApprovalCeiling } from "../../../shared/approval-mode";
import { Select } from "../Select";
import { useDesktopCapabilities } from "../DesktopCapabilities";

type CeilingChoice = ApprovalCeiling | "none";

export function BotApprovalCeiling({ bot }: { bot: Bot }) {
  const { capabilities } = useDesktopCapabilities();
  const [session, setSession] = useState<SessionState | null>(null);
  const desktop = capabilities.host.packaged && window.ogb?.remoteClient?.active !== true;
  const canManage = isOwnerOrAdmin(session) && (desktop || session?.kind === "session");

  useEffect(() => {
    let mounted = true;
    void readSessionState().then((current) => { if (mounted) setSession(current); });
    return () => { mounted = false; };
  }, []);
  const { dispatch, flushBotPatches } = useStore();
  const [draft, setDraft] = useState<CeilingChoice>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const current = bot.approvalCeiling ?? "none";
  const choice = draft ?? current;
  const busy = Boolean(bot.busy || bot.tasks?.some((task) => task.busy));
  const editable = canManage && !busy && !saving;

  const save = async () => {
    if (!editable || choice === current) return;
    setSaving(true);
    setError(undefined);
    try {
      await flushBotPatches(bot.id);
      const { bot: updated } = await api<{ bot: BotAnnouncement }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ approvalCeiling: choice === "none" ? null : choice }),
      });
      dispatch({ type: "botPatched", bot: updated });
      setDraft(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("permissions.ceiling.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-approval-ceiling
      className="rounded-xl border border-hairline/50 bg-app p-4"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <ShieldCheck size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{t("permissions.ceiling.title")}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t("permissions.ceiling.help")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("permissions.ceiling.title")}
          className="min-w-32 flex-1"
          value={choice}
          disabled={!editable}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "ask" || value === "auto" || value === "none") setDraft(value);
            setError(undefined);
          }}
        >
          <option value="none">{t("permissions.ceiling.none")}</option>
          <option value="ask">{t("permissions.ceiling.ask")}</option>
          <option value="auto">{t("permissions.ceiling.auto")}</option>
        </Select>
        {canManage && (
          <button
            type="submit"
            className="ui-button ui-button-primary shrink-0"
            disabled={!editable || choice === current}
          >
            {t(saving ? "permissions.ceiling.saving" : "permissions.ceiling.save")}
          </button>
        )}
      </div>
      {session && !canManage && <p className="mt-2 text-[12px] text-ink-secondary">{t("permissions.ceiling.ownerOnly")}</p>}
      {busy && canManage && <p className="mt-2 text-[12px] text-ink-secondary">{t("permissions.ceiling.busy")}</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
    </form>
  );
}
