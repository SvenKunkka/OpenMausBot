import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Inbox, Maximize2, Minimize2, Search, X } from "lucide-react";
import type { InboxRow } from "../../../shared/inbox";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { closeInbox, readInboxLine, readInboxRow, useInboxPanel, useInboxView, widenInbox } from "@/state/inbox";
import { inboxTaskTab, inboxTasksInTab, useInboxTasks, type InboxTaskTab } from "@/state/inbox-tasks";
import { InboxTaskRows } from "./InboxTaskRows";
import { InboxActive } from "./InboxActive";
import { InboxReading } from "./InboxReading";
import { InboxRowItem } from "./InboxRow";
import { matchesSearch, nextAfter } from "./inbox-answer";
import { listedRows, waitingCount } from "./inbox-view";
import { useInboxActions } from "./use-inbox-actions";
import { roundButtonCls } from "../bot-panel/rows";


export function InboxPanel() {
  const view = useInboxView();
  const panel = useInboxPanel();
  const phone = useMediaQuery(PHONE_LAYOUT);
  const simple = !useAdvancedMode();
  const { run } = useInboxActions(view);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const taskInbox = useInboxTasks();
  const [selectedTab, setTab] = useState<InboxTaskTab | null>(null);
  const tab = selectedTab ?? (panel.reading ? "messages" : inboxTaskTab(taskInbox.tasks));
  const unread = inboxTasksInTab(taskInbox.tasks, "unread").length;
  const active = inboxTasksInTab(taskInbox.tasks, "active").length;
  const tabs = [{ id: "active", count: active }, { id: "unread", count: unread }, { id: "messages", count: 0 }, { id: "all", count: 0 }] as const;
  useEffect(() => {
    if (taskInbox.phase === "ready" && selectedTab === null) setTab(tab);
  }, [taskInbox.phase, selectedTab, tab]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    if (panel.reading) readInboxLine(null);
    else closeInbox();
  };
  const reading = panel.reading ? view?.rows.find((row) => row.id === panel.reading) : undefined;
  const open = (row: InboxRow) => { setTab("messages"); readInboxRow(row); readInboxLine(row.id); };
  const rows = listedRows(view).filter((row) => matchesSearch(row, query));
  const ids = rows.map((row) => row.id);
  const at = reading ? ids.indexOf(reading.id) : -1;

  const order = useRef<string[]>([]);
  if (at >= 0) order.current = ids;
  const waited = useRef<string | null>(null);
  useEffect(() => {
    if (!reading) { waited.current = null; return; }
    if (reading.tab !== "done") { waited.current = reading.id; return; }
    if (waited.current !== reading.id) return;
    waited.current = null;
    const next = nextAfter(order.current.filter((id) => id === reading.id || ids.includes(id)), reading.id);
    const row = next ? view?.rows.find((one) => one.id === next) : undefined;
    if (row) readInboxRow(row);
    readInboxLine(row ? row.id : null);
  }, [reading, ids, view]);

  const step = (by: -1 | 1) => {
    const row = rows[at + by];
    if (row) open(row);
  };
  const count = waitingCount(view);
  const body = (
    <>
      <div className="flex h-[50px] shrink-0 items-start gap-2.5 px-[13px] pt-[13px]">
        <div data-inbox-tab-chip className="flex h-[34px] min-w-0 flex-1 items-center gap-2 ps-1 text-[14px]">
          <Inbox size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <span className="min-w-0 truncate font-medium text-ink">{t("inbox.panel.title")}</span>
          {count > 0 && <span data-inbox-tab-count className="shrink-0 tabular-nums text-ink-tertiary">{count}</span>}
        </div>
        {!phone && (
          <button type="button" onClick={() => widenInbox(!panel.wide)} aria-pressed={Boolean(panel.wide)} aria-label={t(panel.wide ? "inbox.action.narrow" : "inbox.action.widen")}
            title={t(panel.wide ? "inbox.action.narrow" : "inbox.action.widen")} className={roundButtonCls}>
            {panel.wide ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
        )}
        <button type="button" onClick={closeInbox} aria-label={t("inbox.action.closePanel")} title={t("inbox.action.closePanel")} className={roundButtonCls}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {taskInbox.enabled && !reading && <div role="group" aria-label={t("inbox.tasks.filters")} className="mx-2 mb-1.5 flex shrink-0 flex-wrap gap-0.5 border-b border-hairline/40 pb-1.5">
        {tabs.map(({ id, count }) => (
          <button key={id} type="button" data-inbox-task-tab={id} aria-pressed={tab === id} onClick={() => setTab(id)}
            className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/60", tab === id ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink")}>
            {t(`inbox.tasks.tab.${id}`)}
            {count > 0 && <span className="tabular-nums text-ink-secondary">{count}</span>}
          </button>
        ))}
      </div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {reading && view ? (
          <InboxReading view={view} row={reading} now={now} position={at >= 0 ? { index: at, count: rows.length } : null} onStep={step} />
        ) : taskInbox.enabled && tab !== "messages" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InboxTaskRows key={tab} tasks={inboxTasksInTab(taskInbox.tasks, tab)} phase={taskInbox.phase} now={now} />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listedRows(view).length > 0 && <label className="mx-[13px] my-2.5 flex h-8 items-center gap-2 rounded-lg bg-ink/[0.045] px-2.5 ring-[0.5px] ring-ink/[0.12] focus-within:ring-ink/30">
                <Search size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("inbox.search")} aria-label={t("inbox.search")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary [&::-webkit-search-cancel-button]:hidden" />
              </label>}
              <div role="list" data-inbox-list aria-label={t("inbox.panel.title")} className="space-y-0.5 px-1.5 pb-1.5">
                {rows.length === 0
                  ? query.trim() && listedRows(view).length
                    ? <p className="px-4 py-8 text-center text-[13px] text-ink-secondary">{t("inbox.noMatch")}</p>
                    : (
                      <div data-inbox-empty className="mx-auto flex max-w-[16rem] flex-col items-center px-4 py-10 text-center">
                        <Inbox size={22} strokeWidth={1.5} aria-hidden="true" className="text-ink-tertiary" />
                        <p className="mt-3 text-[14px] font-medium text-ink">{t("inbox.empty")}</p>
                        <p className="mt-1 text-[13px] leading-[18px] text-ink-tertiary">{t("inbox.emptyHint")}</p>
                      </div>
                    )
                  : rows.map((row) => <InboxRowItem key={row.id} row={row} now={now} onOpen={open} onAction={run} />)}
              </div>
              {!query.trim() && <InboxActive view={view} />}
            </div>
          </>
        )}
      </div>
    </>
  );
  if (phone) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInbox(); }}>
        <section role="dialog" aria-modal="true" aria-label={t("inbox.panel.title")} data-inbox-panel="sheet" onKeyDown={onKeyDown}
          className="animate-pop-in motion-reduce:animate-none flex max-h-[85dvh] min-h-[50dvh] flex-col overflow-hidden rounded-t-2xl border-t border-hairline/50 bg-panel pb-[env(safe-area-inset-bottom)]">
          {body}
        </section>
      </div>,
      document.body,
    );
  }
  return (
    <aside aria-label={t("inbox.panel.title")} data-inbox-panel="side" data-wide={panel.wide ? "" : undefined} onKeyDown={onKeyDown}
      className={cn("animate-panel-in motion-reduce:animate-none flex h-full max-w-full shrink-0 flex-col max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30",
        simple ? "border-l-[0.5px] border-ink/[0.06] bg-app" : "border-l border-hairline/40 bg-panel",
        panel.wide ? "w-[min(640px,60vw)]" : simple ? "w-[320px]" : "w-[380px]")}>
      {body}
    </aside>
  );
}
