import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxTask } from "../../shared/inbox-task";
import { inboxTaskTab, inboxTasksInTab, markInboxTaskRead, refreshInboxTasks, setInboxTasksEnabled, currentInboxTasks } from "./inbox-tasks";
import { api } from "./api";

vi.mock("./api", () => ({ api: vi.fn() }));
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: vi.fn() }));

const task = (id: string, patch: Partial<InboxTask> = {}): InboxTask => ({
  id, botId: "bot", threadId: "thread", sendId: id, title: id,
  status: "replied", createdAt: 1, updatedAt: 2, resultMessageId: `reply-${id}`, ...patch,
});

afterEach(() => {
  setInboxTasksEnabled(false);
  vi.resetAllMocks();
});

describe("task inbox", () => {
  it("separates active tasks and unread results, while keeping everything findable", () => {
    const items = [
      task("first"),
      task("running", { status: "running", resultMessageId: undefined }),
      task("seen", { seenAt: 3 }),
      task("stopped", { status: "stopped", resultMessageId: undefined, reason: "Stopped" }),
      task("queued", { status: "queued", resultMessageId: undefined }),
    ];
    expect(inboxTaskTab(items)).toBe("unread");
    expect(inboxTaskTab(items.filter((item) => item.id !== "first" && item.id !== "stopped"))).toBe("active");
    expect(inboxTasksInTab(items, "unread").map((item) => item.id)).toEqual(["first", "stopped"]);
    expect(inboxTasksInTab(items, "active").map((item) => item.id)).toEqual(["running", "queued"]);
    expect(inboxTasksInTab(items, "all")).toHaveLength(5);
  });

  it("orders active tasks by who must act, then by FIFO with stable creation ties", () => {
    const items = [
      task("third", { status: "queued", createdAt: 2 }),
      task("second", { status: "queued", createdAt: 2 }),
      task("first", { status: "queued", createdAt: 1 }),
      task("approval", { status: "waiting-input", createdAt: 4 }),
      task("running", { status: "running", createdAt: 3 }),
    ];
    expect(inboxTasksInTab(items, "active").map((item) => item.id)).toEqual(["approval", "running", "first", "second", "third"]);
  });

  it("only marks the exact task after the server acknowledges, and preserves unread on failure", async () => {
    const items = [task("first"), task("second")];
    vi.mocked(api).mockResolvedValueOnce({ tasks: items });
    setInboxTasksEnabled(true);
    await refreshInboxTasks();
    vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
    expect(await markInboxTaskRead("second")).toBe(false);
    expect(inboxTasksInTab(currentInboxTasks().tasks, "unread")).toHaveLength(2);
    vi.mocked(api).mockResolvedValueOnce({ ok: true });
    expect(await markInboxTaskRead("second")).toBe(true);
    expect(api).toHaveBeenLastCalledWith("/api/inbox/tasks/second/read", expect.objectContaining({ method: "POST" }));
    expect(inboxTasksInTab(currentInboxTasks().tasks, "unread").map((item) => item.id)).toEqual(["first"]);
  });
});
