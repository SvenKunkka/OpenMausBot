import { useEffect, useSyncExternalStore } from "react";
import type { InboxTask } from "../../shared/inbox-task";
import { listenLiveFrames } from "@/lib/live-events";
import { api } from "./api";

export type InboxTaskTab = "active" | "unread" | "messages" | "all";

export function inboxTaskActive(task: InboxTask): boolean {
  return task.status === "queued" || task.status === "running" || task.status === "waiting-input" || task.status === "waiting-work";
}

export const inboxTaskUnread = (task: InboxTask): boolean => !inboxTaskActive(task) && task.seenAt === undefined;

const activePriority = (task: InboxTask): number => task.status === "waiting-input" ? 0 : task.status === "queued" ? 2 : 1;

export function inboxTasksInTab(tasks: readonly InboxTask[], tab: InboxTaskTab): InboxTask[] {
  if (tab === "active") {
    return tasks.filter(inboxTaskActive).reverse().sort((a, b) => activePriority(a) - activePriority(b) || a.createdAt - b.createdAt);
  }
  if (tab === "unread") return tasks.filter(inboxTaskUnread);
  return tab === "all" ? [...tasks] : [];
}

export const inboxTaskTab = (tasks: readonly InboxTask[]): InboxTaskTab => tasks.some(inboxTaskUnread) ? "unread" : "active";

type InboxTasksState = { enabled: boolean; phase: "loading" | "ready" | "error"; tasks: InboxTask[] };
let snapshot: InboxTasksState = { enabled: false, phase: "loading", tasks: [] };
let generation = 0;
let readRevision = 0;
let reading: Promise<void> | null = null;
let readAgain = false;
const listeners = new Set<() => void>();
const marks = new Map<string, Promise<boolean>>();

const show = (next: InboxTasksState) => {
  snapshot = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const currentInboxTasks = () => snapshot;
export const useInboxTasks = () => useSyncExternalStore(subscribe, currentInboxTasks, currentInboxTasks);

export function setInboxTasksEnabled(enabled: boolean): void {
  if (snapshot.enabled === enabled) return;
  generation++;
  reading = null;
  readAgain = false;
  marks.clear();
  show({ enabled, phase: "loading", tasks: [] });
}

export function refreshInboxTasks(): Promise<void> {
  if (!snapshot.enabled) return Promise.resolve();
  if (reading) { readAgain = true; return reading; }
  const place = generation;
  reading = (async () => {
    try {
      do {
        readAgain = false;
        const revision = readRevision;
        try {
          const view = await api<{ tasks: InboxTask[] }>("/api/inbox/tasks", { background: true, timeoutMs: 10_000 });
          if (generation !== place) return;
          if (!Array.isArray(view.tasks)) throw new Error("Invalid task list");
          if (revision === readRevision) show({ enabled: true, phase: "ready", tasks: view.tasks });
          else readAgain = true;
        } catch (error) {
          if (generation !== place) return;
          if ((error as { status?: number }).status === 404) setInboxTasksEnabled(false);
          else show({ ...snapshot, phase: "error" });
        }
      } while (readAgain && generation === place);
    } finally {
      if (generation === place) reading = null;
    }
  })();
  return reading;
}

export function markInboxTaskRead(id: string): Promise<boolean> {
  const pending = marks.get(id);
  if (pending) return pending;
  const task = snapshot.tasks.find((row) => row.id === id);
  if (!task || !inboxTaskUnread(task)) return Promise.resolve(Boolean(task));
  const place = generation;
  const request = api<{ ok: boolean }>(`/api/inbox/tasks/${encodeURIComponent(id)}/read`, { method: "POST", timeoutMs: 10_000 })
    .then(({ ok }) => {
      if (!ok || generation !== place) return false;
      readRevision++;
      show({ ...snapshot, tasks: snapshot.tasks.map((row) => row.id === id ? { ...row, seenAt: row.seenAt ?? Date.now() } : row) });
      return true;
    })
    .catch(() => false)
    .finally(() => { if (marks.get(id) === request) marks.delete(id); });
  marks.set(id, request);
  return request;
}

export function useInboxTasksLoader(enabled: boolean, connected: boolean): void {
  useEffect(() => {
    setInboxTasksEnabled(enabled);
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState === "visible") void refreshInboxTasks(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    const stop = listenLiveFrames({
      onFrame: (frame) => { if (frame.kind === "inbox-tasks.changed") refresh(); },
      onMissedFrames: refresh,
    });
    return () => {
      stop();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      setInboxTasksEnabled(false);
    };
  }, [enabled]);
  useEffect(() => {
    if (connected && enabled && document.visibilityState === "visible") void refreshInboxTasks();
  }, [connected, enabled]);
}
