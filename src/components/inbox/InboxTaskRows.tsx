import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Inbox } from "lucide-react";
import type { InboxTask } from "../../../shared/inbox-task";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/relative-time";
import { closeInbox } from "@/state/inbox";
import { inboxTaskUnread, markInboxTaskRead, refreshInboxTasks } from "@/state/inbox-tasks";
import { api, MESSAGE_PAGE_SIZE, useStore, visibleMessages, type Message } from "@/state/store";

export function InboxTaskRows({ tasks, phase, now }: {
  tasks: InboxTask[];
  phase: "loading" | "ready" | "error";
  now: number;
}) {
  const { state, dispatch } = useStore();
  const navigation = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => navigation.current?.abort(), []);

  const open = async (task: InboxTask) => {
    const owner = state.bots.find((bot) => bot.id === task.botId);
    if (!owner) { setError(t("chat.conversationGone")); return; }
    navigation.current?.abort();
    const request = new AbortController();
    navigation.current = request;
    setOpening(task.id);
    setError(null);
    const messageId = (task.status === "waiting-input" ? task.cardMessageId : task.resultMessageId) ?? task.sourceMessageId;
    const readingResult = Boolean(task.resultMessageId && messageId === task.resultMessageId && inboxTaskUnread(task));
    const failed = (message: string) => {
      if (request.signal.aborted) return;
      setError(message);
      setOpening(null);
    };
    try {
      let archivedMessages: Message[] | undefined;
      if (messageId) {
        const page = await api<{ messages: Message[] }>(
          `/api/threads/${encodeURIComponent(task.threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}&around=${encodeURIComponent(messageId)}`,
          { signal: request.signal, timeoutMs: 10_000 },
        );
        if (!page.messages?.some((message) => message.id === messageId)) throw new Error();
        archivedMessages = visibleMessages({ messages: page.messages, activeLeafId: messageId });
      }
      if (request.signal.aborted) return;
      const arrived = () => {
        if (request.signal.aborted) return;
        if (messageId) dispatch({ type: "focusMessage", threadId: task.threadId, messageId, archivedMessages, ...(readingResult ? { inboxTaskId: task.id } : {}) });
        closeInbox();
      };
      if (task.status === "waiting-input" || owner.threadId !== task.threadId || owner.switchingTo) {
        dispatch({ type: "switchTask", botId: task.botId, threadId: task.threadId, onSwitched: arrived, onError: failed });
      } else {
        dispatch({ type: "select", id: task.botId });
        arrived();
      }
    } catch {
      failed(t("inbox.tasks.openFailed"));
    }
  };

  return (
    <div className="px-1.5 pb-1.5">
      {error && <p role="alert" className="mx-2 my-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
      {phase === "error" && <p role="status" className="mx-2 my-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink-secondary">
        {t("inbox.tasks.loadFailed")}{" "}
        <button type="button" className="rounded font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => void refreshInboxTasks()}>{t("inbox.tasks.retry")}</button>
      </p>}
      {tasks.length === 0 && phase !== "error" && <div className="mx-auto flex max-w-[16rem] flex-col items-center px-4 py-10 text-center">
        <Inbox size={22} strokeWidth={1.5} aria-hidden="true" className="text-ink-tertiary" />
        <p className="mt-3 text-[14px] font-medium text-ink">{t(phase === "loading" ? "inbox.tasks.loading" : "inbox.tasks.empty")}</p>
      </div>}
      <ul className="divide-y divide-hairline/40">
        {tasks.map((task) => {
          const bot = state.bots.find((candidate) => candidate.id === task.botId);
          const unread = inboxTaskUnread(task);
          const title = task.title.trim() || t("inbox.tasks.untitled");
          const failure = task.status === "failed" || task.status === "stopped" || task.status === "interrupted";
          const noResult = failure && !task.resultMessageId;
          const detailsShown = noResult && expanded === task.id;
          const at = task.progress?.at ?? task.updatedAt;
          const label = t(`inbox.tasks.status.${task.status}`);
          const progress = failure ? task.reason ?? task.progress?.text : task.progress?.text ?? task.reason;
          return <li key={task.id} data-inbox-task={task.id} data-status={task.status} data-unread={unread ? "" : undefined}
            className="rounded-md hover:bg-raised/60">
            <div className="flex min-w-0 items-center gap-0.5">
              <button type="button" onClick={() => {
                if (noResult) setExpanded(detailsShown ? null : task.id);
                else void open(task);
              }} aria-expanded={noResult ? detailsShown : undefined} aria-busy={opening === task.id}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span dir="auto" className={cn("min-w-0 max-w-full break-words text-[14px] leading-5 text-ink [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium")}>{title}</span>
                    <span className={cn("shrink-0 text-[12px] font-medium", failure ? "text-danger" : unread || task.status === "running" ? "text-accent" : "text-ink-secondary")}>{label}</span>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2 text-[12px] text-ink-secondary">
                    <span dir="auto" className="min-w-0 truncate">{bot?.name ?? t("inbox.tasks.unknownBot")}</span>
                    <time dateTime={new Date(at).toISOString()} className="shrink-0 text-ink-tertiary">{localizedRelativeTime(at, activeLocale(), now)}</time>
                  </span>
                  {progress && <span dir="auto" className={cn("mt-0.5 block break-words text-[12px] leading-4 text-ink-secondary [overflow-wrap:anywhere]", (!failure || noResult) && "line-clamp-2")}>{progress}</span>}
                </span>
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
              </button>
              {unread && <button type="button" aria-label={t("inbox.tasks.markReadTitle", { title })} title={t("inbox.tasks.markRead")}
                onClick={() => { setError(null); void markInboxTaskRead(task.id).then((ok) => { if (!ok) setError(t("inbox.tasks.markFailed")); }); }}
                className="me-1 grid size-8 shrink-0 place-items-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
                <Check size={15} aria-hidden="true" />
              </button>}
            </div>
            {detailsShown && <div className="mx-2.5 mb-2.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink-secondary">
              <p dir="auto" className="break-words [overflow-wrap:anywhere]">{task.reason || t("inbox.tasks.noResult")}</p>
              <button type="button" onClick={() => void open(task)} className="mt-1.5 rounded font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-focus">
                {t("inbox.tasks.openChat")}
              </button>
            </div>}
          </li>;
        })}
      </ul>
    </div>
  );
}
