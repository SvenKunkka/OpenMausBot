// Rows are `display: contents` wrappers with no box, so their last child is what gets scrolled and highlighted.
import { useEffect, type RefObject } from "react";
import { api, MESSAGE_PAGE_SIZE, useStore, type Action, type AppState, type Message } from "@/state/store";
import type { SearchHit } from "@/lib/search-hit";
import { markInboxTaskRead } from "@/state/inbox-tasks";
import { t } from "@/lib/i18n";

const FLASH_CLASSES = ["ring-2", "ring-accent/70", "rounded-2xl", "transition-shadow"];

async function loadThroughMessage(
  owner: { threadId: string; messages: Message[]; hasMore?: boolean },
  messageId: string,
  generation: number,
  dispatch: React.Dispatch<Action>,
): Promise<void> {
  if (!owner.hasMore || owner.messages.some((message) => message.id === messageId)) return;
  const older: Message[] = [];
  let before = owner.messages[0]?.id;
  let hasMore = true;
  let found = false;
  while (before && hasMore && !found) {
    const page = await api<{ messages?: Message[]; hasMore?: boolean }>(
      `/api/threads/${owner.threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
    );
    const messages = page.messages ?? [];
    older.unshift(...messages);
    found = messages.some((message) => message.id === messageId);
    hasMore = Boolean(page.hasMore) && messages.length > 0;
    before = messages[0]?.id;
  }
  if (older.length) dispatch({ type: "olderMessages", threadId: owner.threadId, generation, messages: older, hasMore });
}

export async function landOnSearchHit(
  hit: SearchHit,
  state: Pick<AppState, "bots" | "groups" | "transcriptGeneration">,
  dispatch: React.Dispatch<Action>,
  threadsShown: boolean,
): Promise<void> {
  const ownerId = hit.botId ?? hit.groupId;
  const bot = hit.botId ? state.bots.find((candidate) => candidate.id === hit.botId) : undefined;
  const group = hit.groupId ? state.groups.find((candidate) => candidate.id === hit.groupId) : undefined;
  if (!ownerId || (!bot && !group)) throw new Error(t("chat.conversationGone"));

  const switchAlone = bot && bot.threadId !== hit.threadId && !threadsShown ? bot : undefined;
  if (!switchAlone) dispatch({ type: "select", id: ownerId });
  if (bot && bot.threadId !== hit.threadId && !switchAlone) {
    const result = await api(`/api/bots/${bot.id}/tasks/${hit.threadId}`, { method: "POST" });
    if (result?.bot) dispatch({ type: "taskSwitched", bot: result.bot });
  }
  if (group && group.threadId !== hit.threadId) {
    const result = await api(`/api/groups/${group.id}/tasks/${hit.threadId}`, { method: "POST" });
    if (result?.group) dispatch({ type: "groupPatched", group: result.group });
  }
  const open = bot?.threadId === hit.threadId ? bot : group?.threadId === hit.threadId ? group : undefined;
  if (open) await loadThroughMessage(open, hit.messageId, state.transcriptGeneration[hit.threadId] ?? 0, dispatch);
  if (bot && !hit.onActivePath) {
    const branch = await api(`/api/bots/${bot.id}/active-branch`, {
      method: "POST",
      body: JSON.stringify({ messageId: hit.messageId, threadId: hit.threadId }),
    });
    if (branch?.activeLeafId) {
      dispatch({ type: "threadActive", threadId: hit.threadId, activeLeafId: branch.activeLeafId });
    }
  }
  if (switchAlone) dispatch({ type: "switchTask", botId: switchAlone.id, threadId: hit.threadId, whole: true });
  dispatch({
    type: "focusMessage",
    threadId: hit.threadId,
    messageId: hit.messageId,
    matchText: hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength),
  });
}

function matchRange(root: HTMLElement, text: string): Range | null {
  const needle = text.trim();
  if (!needle) return null;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let rendered = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    rendered += node.data;
  }
  const pattern = needle.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern, "iu").exec(rendered);
  if (!match) return null;
  const range = document.createRange();
  let offset = 0;
  for (const node of nodes) {
    const end = offset + node.length;
    if (match.index >= offset && match.index < end) range.setStart(node, match.index - offset);
    if (match.index + match[0].length <= end) {
      range.setEnd(node, match.index + match[0].length - offset);
      return range;
    }
    offset = end;
  }
  return null;
}

export function messageIsVisible(target: HTMLElement, viewport: HTMLElement): boolean {
  if (!document.hasFocus() || document.visibilityState !== "visible" || !target.isConnected) return false;
  const row = target.getBoundingClientRect();
  const bounds = viewport.getBoundingClientRect();
  const left = Math.max(0, row.left, bounds.left);
  const right = Math.min(window.innerWidth, row.right, bounds.right);
  const top = Math.max(0, row.top, bounds.top);
  const bottom = Math.min(window.innerHeight, row.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return false;
  const x = (left + right) / 2;
  return [0.25, 0.5, 0.75].some((part) => target.contains(document.elementFromPoint(x, top + (bottom - top) * part)));
}

export function useFocusMessage(threadId: string, ready: boolean, viewport?: RefObject<HTMLElement | null>) {
  const { state, dispatch } = useStore();
  const focus = state.focusMessage;
  useEffect(() => {
    if (!focus || focus.consumed || focus.threadId !== threadId || !ready) return;
    let tries = 0;
    let visibleTries = 0;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollFrame: number | null = null;
    let target: HTMLElement | null = null;
    let highlight: Highlight | null = null;
    const consume = () => dispatch({ type: "focusMessageConsumed", nonce: focus.nonce });
    const failed = () => {
      if (!focus.archivedMessages) return;
      consume();
      dispatch({ type: "error", message: t("inbox.tasks.openFailed") });
    };
    const waitForVisible = () => {
      if (cancelled || !target || !focus.inboxTaskId) return;
      const root = viewport?.current;
      if (root && messageIsVisible(target, root)) {
        consume();
        void markInboxTaskRead(focus.inboxTaskId).then((ok) => {
          if (!ok && !cancelled) dispatch({ type: "error", message: t("inbox.tasks.markFailed") });
        });
        return;
      }
      if (document.hasFocus() && document.visibilityState === "visible" && visibleTries++ >= 20) failed();
      else retryTimer = setTimeout(waitForVisible, 150);
    };
    const attempt = () => {
      if (cancelled) return;
      const root = viewport?.current ?? document;
      const wrapper = root.querySelector<HTMLElement>(`[data-mid="${CSS.escape(focus.messageId)}"]`);
      const row = wrapper?.lastElementChild as HTMLElement | null;
      target = focus.inboxTaskId
        ? wrapper?.querySelector<HTMLElement>("[data-chat-bubble]") ?? row
        : focus.matchText ? row?.querySelector<HTMLElement>("[data-chat-bubble]") ?? row : row;
      if (!target) {
        if (tries++ < 20) retryTimer = setTimeout(attempt, 100);
        else failed();
        return;
      }
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      target.scrollIntoView({ block: "center", behavior: reducedMotion || focus.archivedMessages ? "auto" : "smooth" });
      target.classList.add(...FLASH_CLASSES);
      // A reply split into bubbles and table cards has several text roots; a quoted reply's text is not the message's.
      const found = target.querySelectorAll<HTMLElement>(".chat-md, .chat-text");
      const textRoots: HTMLElement[] = [];
      for (let index = 0; index < found.length; index++) {
        const root = found.item(index);
        if (root && !root.closest?.("[data-reply-quote]")) textRoots.push(root);
      }
      let range: Range | null = null;
      for (const root of textRoots.length ? textRoots : [target]) if ((range = matchRange(root, focus.matchText ?? ""))) break;
      if (range && CSS.highlights) {
        highlight = new Highlight(range);
        CSS.highlights.set("search-result-text", highlight);
        scrollFrame = requestAnimationFrame(() => {
          const scroller = target?.closest<HTMLElement>(".overflow-y-auto");
          if (!scroller) return;
          const match = range.getBoundingClientRect();
          const viewport = scroller.getBoundingClientRect();
          scroller.scrollTop += match.top + match.height / 2 - viewport.top - viewport.height / 2;
        });
      }
      // `consumed` is deliberately not a dependency, so this flash survives the bookkeeping update.
      if (focus.inboxTaskId) retryTimer = setTimeout(waitForVisible, 0);
      else consume();
      flashTimer = setTimeout(() => target?.classList.remove(...FLASH_CLASSES), 1800);
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (flashTimer) clearTimeout(flashTimer);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      target?.classList.remove(...FLASH_CLASSES);
      if (highlight && CSS.highlights.get("search-result-text") === highlight) CSS.highlights.delete("search-result-text");
    };
  }, [dispatch, focus?.nonce, focus?.threadId, focus?.messageId, threadId, ready, viewport]);
}
