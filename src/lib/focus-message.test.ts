import type { EffectCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ effect: null as EffectCallback | null, text: "", inboxTaskId: undefined as string | undefined, dispatch: vi.fn(), mark: vi.fn() }));
vi.mock("react", () => ({ useEffect: (effect: EffectCallback) => { fixture.effect = effect; } }));
vi.mock("@/state/inbox-tasks", () => ({ markInboxTaskRead: fixture.mark }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { focusMessage: { threadId: "thread", messageId: "message", matchText: fixture.text, inboxTaskId: fixture.inboxTaskId, nonce: 1, consumed: false } }, dispatch: fixture.dispatch }),
}));

import { useFocusMessage } from "./focus-message";

let cleanup: (() => void) | undefined;
let ranges: Array<{ start: number; end: number }>;
let highlights: Map<string, unknown>;
let target: { scrollIntoView: ReturnType<typeof vi.fn>; classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }; querySelector: () => unknown; querySelectorAll: () => { item: () => unknown; length: number } };
beforeEach(() => {
  vi.useFakeTimers();
  fixture.dispatch.mockClear();
  fixture.mark.mockReset().mockResolvedValue(true);
  fixture.inboxTaskId = undefined;
  ranges = [];
  highlights = new Map();
  const node = { data: "alpha\nbeta a.b", length: 14 };
  target = { scrollIntoView: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() }, querySelector: () => target, querySelectorAll: () => ({ item: () => target, length: 1 }) };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  vi.stubGlobal("CSS", { escape: (value: string) => value, highlights });
  vi.stubGlobal("Highlight", class { constructor(readonly range: unknown) {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("document", {
    querySelector: () => ({ lastElementChild: target }),
    createTreeWalker: () => {
      let available = true;
      return { currentNode: node, nextNode: () => { const result = available; available = false; return result; } };
    },
    createRange: () => {
      const range = { start: -1, end: -1, setStart: (_node: unknown, offset: number) => { range.start = offset; }, setEnd: (_node: unknown, offset: number) => { range.end = offset; } };
      ranges.push(range);
      return range;
    },
  });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

function focus(text: string, viewport?: HTMLElement) {
  fixture.text = text;
  useFocusMessage("thread", true, viewport ? { current: viewport } : undefined);
  cleanup = fixture.effect!() as () => void;
}

describe("search match highlighting", () => {
  it.each(["", " ", "\t\r\n"])("does not create an empty range for %j", (text) => {
    focus(text);
    expect(ranges).toEqual([]);
    expect(highlights.size).toBe(0);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "focusMessageConsumed", nonce: 1 });
  });

  it.each([[" alpha beta ", 0, 10], ["a.b", 11, 14]])("keeps the literal nonempty match %j", (text, start, end) => {
    focus(text as string);
    expect(ranges).toMatchObject([{ start, end }]);
    expect(highlights.has("search-result-text")).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });
});

describe("unread task visibility", () => {
  it("marks only the requested result once its viewport is in front and the reply is unobscured", async () => {
    fixture.inboxTaskId = "requested-task";
    const box = { left: 10, right: 100, top: 10, bottom: 100 };
    let foreground = false;
    let obscured = true;
    Object.assign(target, {
      isConnected: true,
      getBoundingClientRect: () => box,
      contains: (node: unknown) => node === target,
    });
    Object.assign(window, { innerWidth: 100, innerHeight: 100 });
    Object.assign(document, {
      hasFocus: () => foreground,
      visibilityState: "visible",
      elementFromPoint: () => obscured ? null : target,
    });
    const viewport = {
      getBoundingClientRect: () => box,
      querySelector: () => ({ lastElementChild: target, querySelector: () => target }),
    } as unknown as HTMLElement;
    focus("", viewport);
    await vi.advanceTimersByTimeAsync(150);
    expect(fixture.mark).not.toHaveBeenCalled();
    foreground = true;
    await vi.advanceTimersByTimeAsync(150);
    expect(fixture.mark).not.toHaveBeenCalled();
    obscured = false;
    await vi.advanceTimersByTimeAsync(150);
    expect(fixture.mark).toHaveBeenCalledExactlyOnceWith("requested-task");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "focusMessageConsumed", nonce: 1 });
  });
});
