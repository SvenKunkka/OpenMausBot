import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { WireBot, WireTask } from "../shared/wire.ts";

interface FixtureResponse {
  bot: WireBot;
  task: WireTask;
  code: string;
  token: string;
  error: string;
}

it("gives the signed-in administrator a persistent ceiling over a bot and its conversations", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", origin: url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() as FixtureResponse };
  };
  const pair = async (scopes: string[]) => {
    const opened = await api("POST", "/api/auth/pairing", { scopes });
    expect(opened.status).toBe(200);
    const joined = await api("POST", "/api/auth/pair", { code: opened.body.code, label: "Approval test" });
    expect(joined.status).toBe(200);
    return joined.body.token;
  };
  try {
    const admin = await pair(["admin", "client"]);
    const member = await pair(["client"]);
    const { body: { bot } } = await api("POST", "/api/bots", { name: "Ceiling fixture" }, admin);
    expect(bot.approvalMode).toBe("ask");
    const botPath = `/api/bots/${bot.id}`;
    const { body: { task } } = await api("POST", `${botPath}/tasks`, { title: "Second chat" }, admin);
    expect(task.approvalMode).toBe("ask");
    const taskPath = `${botPath}/tasks/${task.threadId}`;
    expect((await api("PATCH", botPath, { approvalMode: "full", applyToAllThreads: true }, admin)).status).toBe(200);

    expect((await api("PATCH", botPath, { approvalCeiling: "ask" })).status).toBe(403);
    expect((await api("PATCH", botPath, { approvalCeiling: "ask" }, member)).status).toBe(403);
    expect((await api("PATCH", botPath, { approvalCeiling: "full" }, admin)).status).toBe(400);
    const capped = await api("PATCH", botPath, { approvalCeiling: "ask" }, admin);
    expect(capped.status, JSON.stringify(capped.body)).toBe(200);
    expect(capped.body.bot).toMatchObject({ approvalCeiling: "ask", approvalMode: "ask" });
    expect(capped.body.bot.tasks?.map(chat => chat.approvalMode)).toEqual(["ask", "ask"]);

    const rejected = await api("PATCH", taskPath, { approvalMode: "full" }, admin);
    expect(rejected.status).toBe(403);
    expect(rejected.body.error).toMatch(/approval ceiling/);
    expect((await api("PATCH", botPath, { autoApprove: true }, admin)).status).toBe(403);
    expect((await api("POST", `${botPath}/tasks`, { approvalMode: "full" }, admin)).body.error).toMatch(/approval ceiling/);
    expect((await api("PATCH", taskPath, { refreshPermissions: true }, admin)).body.task.approvalMode).toBe("ask");
    const saved = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")).find((row: { id: string }) => row.id === bot.id);
    expect(saved).toMatchObject({ approvalCeiling: "ask", approvalMode: "ask" });
    expect(saved.tasks.map((chat: { approvalMode?: string }) => chat.approvalMode)).toEqual(["ask", "ask"]);

    const cleared = await api("PATCH", botPath, { approvalCeiling: null }, admin);
    expect(cleared.status).toBe(200);
    expect(cleared.body.bot.approvalCeiling).toBeUndefined();
    expect(cleared.body.bot.approvalMode).toBe("ask");
    expect(cleared.body.bot.tasks?.map(chat => chat.approvalMode)).toEqual(["ask", "ask"]);
  } finally {
    await fixture.close();
  }
}, 60_000);
