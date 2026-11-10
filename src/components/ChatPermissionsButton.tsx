import { ShieldAlert, ShieldCheck } from "lucide-react";

import { approvalModeOptions, approvalModeOptionsFor, shownApprovalMode } from "@/lib/approval-mode-options";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { approvalModeFor } from "../../shared/approval-mode";
import { openBotSettings } from "./bot-panel/panel-link";

export function ChatPermissionsButton({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const driverKind = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.driverKind ?? "";
  const mode = shownApprovalMode(driverKind, approvalModeFor(bot));
  const label = approvalModeOptionsFor(driverKind).find((option) => option.mode === mode)?.label
    ?? approvalModeOptions().find((option) => option.mode === mode)?.label;
  const title = t("permissions.center.open", { mode: label ?? "" });
  const Icon = mode === "full" ? ShieldAlert : ShieldCheck;

  return (
    <button
      type="button"
      data-chat-permissions={mode}
      aria-label={title}
      title={title}
      onClick={() => openBotSettings(dispatch, "permissions", { page: "approvals" })}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-secondary hover:bg-control hover:text-ink max-md:size-11 max-md:justify-center max-md:p-0"
    >
      <Icon size={16} aria-hidden="true" className={mode === "full" ? "text-warning" : "text-accent"} />
      <span className="max-md:sr-only">{t("permissions.center.title")}</span>
      {label && <span data-chat-permission-mode className="hidden truncate border-s border-hairline/50 ps-1.5 text-[12px] @min-[47rem]/chathead:block">{label}</span>}
    </button>
  );
}
