import { approvalModeFor, threadApproval } from "../../shared/approval-mode.ts";
import type { InboxTask } from "../../shared/inbox.ts";
import type { WireBot, WireTask } from "../../shared/wire.ts";
import type { KeepWarmStatus } from "../cache-keepwarm.ts";
import type { ModelSelection } from "../contracts.ts";
import type { BotRecord, TaskRecord } from "../store.ts";
import { toWireTask } from "../task-wire.ts";

export function createBotWire(context: {
  awaitingTeammates: () => ReadonlySet<string>;
  botByThread: (threadId: string) => BotRecord | null;
  keepWarm: (threadId: string) => KeepWarmStatus | undefined;
  ownTurn: (threadId: string) => boolean;
  inbox: (threadId: string) => InboxTask;
  threadBusy: (botId: string, threadId: string) => boolean;
  mainThread: (botId: string) => string | undefined;
}) {
  const wireTask = (task: TaskRecord, botModel: ModelSelection, awaiting = context.awaitingTeammates(), bot = context.botByThread(task.threadId)): WireTask => {
    // Snoozes heal on read against the server clock; the 0 sentinel ("until new activity") survives reads.
    const { snoozedUntil, ...base } = toWireTask(task, botModel);
    const approvalMode = approvalModeFor({
      ...threadApproval(task, bot ?? {}), approvalCeiling: bot?.approvalCeiling, approvalGrant: bot?.approvalGrant, threadId: task.threadId,
    });
    const keepWarm = context.keepWarm(task.threadId);
    const coordinated = { ...base, approvalMode, autoApprove: approvalMode === "auto", waitingForTeammates: awaiting.has(task.threadId) && !task.busy, ...(keepWarm ? { cacheKeepWarm: keepWarm } : {}), ...(context.ownTurn(task.threadId) ? { private: true as const } : {}), ...context.inbox(task.threadId) };
    const asleep = snoozedUntil === 0 || (snoozedUntil !== undefined && snoozedUntil > Date.now());
    return asleep ? { ...coordinated, snoozedUntil } : coordinated;
  };

  /** Strips provider session ids (resumeCursors) here, not at call sites, so no broadcast or paired phone ever gets them. */
  const wireBot = (bot: BotRecord): WireBot => {
    const { resumeCursors: _resumeCursors, tasks, approvalGrant, lastProfileRequestId: _lastProfileRequestId, lastTeamSetupReceipt: _lastTeamSetupReceipt, packageBase: _packageBase, assignedSkills: _assignedSkills, mainThreadChoice: _mainThreadChoice, ...rest } = bot;
    // Clients see Ask while an elevated grant awaits the desktop's confirmation, never a grant that may still roll back.
    const approvalMode = approvalModeFor({ ...rest, approvalGrant: approvalGrant?.threadOnly ? undefined : approvalGrant });
    const visible = {
      ...rest, approvalMode,
      ...(rest.autoApprove !== undefined || (approvalGrant && !approvalGrant.threadOnly) ? { autoApprove: approvalMode === "auto" } : {}),
    };
    const awaiting = context.awaitingTeammates();
    return { ...visible, waitingForTeammates: awaiting.has(bot.threadId) && !context.threadBusy(bot.id, bot.threadId),
      mainThreadId: context.mainThread(bot.id),
      avatarUrl: visible.avatarUrl ?? null, ...(tasks ? { tasks: tasks.map((task) => wireTask(task, bot.modelSelection, awaiting, bot)) } : {}) };
  };

  const wireTrustedApprovalBot = (bot: BotRecord) => {
    const { resumeCursors: _resumeCursors, tasks, approvalGrant: _approvalGrant, lastProfileRequestId: _lastProfileRequestId, lastTeamSetupReceipt: _lastTeamSetupReceipt, packageBase: _packageBase, assignedSkills: _assignedSkills, mainThreadChoice: _mainThreadChoice, ...rest } = bot;
    const awaiting = context.awaitingTeammates();
    const approvalMode = approvalModeFor(rest);
    return { ...rest, approvalMode, ...(rest.autoApprove !== undefined ? { autoApprove: approvalMode === "auto" } : {}), mainThreadId: context.mainThread(bot.id), avatarUrl: rest.avatarUrl ?? null, ...(tasks ? { tasks: tasks.map((task) => wireTask(task, bot.modelSelection, awaiting, bot)) } : {}) };
  };

  return { wireBot, wireTask, wireTrustedApprovalBot };
}
