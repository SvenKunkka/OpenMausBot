import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, createWriteStream, readdirSync } from "node:fs";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runControlOmb } from "./OpenMausBot/scripts/control-omb.ts";
const fixtures = [createServer(), createServer()];
await Promise.all(fixtures.map(server => new Promise<void>(done => server.listen(0, "127.0.0.1", done))));
const [port, webhookPort] = fixtures.map(server => server.address().port);
await Promise.all(fixtures.map(server => new Promise<void>(done => server.close(() => done()))));
const home = process.env.HOME;
const feishuProfile = process.env.SVEN_BOTS_FEISHU_PROFILE;
const feishuChatId = process.env.SVEN_BOTS_FEISHU_TEST_CHAT;
assert(feishuProfile && feishuChatId, "Provide a Feishu profile and a test chat");
const dataDir = mkdtempSync(resolve("../sven-bots-platform-fixture-"));
const helper = resolve("../sven-bots-integrations");
execFileSync(process.execPath, [join(helper, "seed-inbox-fixture.mts"), dataDir]);
const log = createWriteStream(resolve("../sven-bots-platform-fixture.log"), { flags: "w", mode: 0o600 });
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  instances: { "codex-local": { driver: "codex", config: { cli: join(home, ".local/bin/codex") } } },
  defaultModelSelection: { instanceId: "codex-local", model: "gpt-5.6-sol" },
  mcpServers: { "platform-messages": { command: "/opt/homebrew/bin/python3", args: [join(helper, "platform-messages.py"), "--profile", feishuProfile, "--inbox", join(dataDir, "inbox.sqlite")], enabled: true } },
}), { mode: 0o600 });
const bundle = "/Applications/Sven Bots.app/Contents/Resources";
const server = spawn(process.execPath, [join(bundle, "server/index.js")], {
  env: { HOME: home, PATH: process.env.PATH, OMB_DATA_DIR: dataDir, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhookPort),
    OMB_LOOPBACK_TRUST: "owner", OMB_RESOURCES_PATH: bundle, OMB_STATIC_DIR: join(bundle, "ui") },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const url = "http://127.0.0.1:" + port;
const control = (args: string[]) => runControlOmb([...args, "--url", url]);
const waitClosed = once(server, "close");
const api = (endpoint: string, init: RequestInit = {}, token?: string) => fetch(url + endpoint, {
  ...init,
  headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
  signal: AbortSignal.timeout(8_000),
});
try {
  let serving = false;
  for (let attempt = 0; attempt < 65 && server.exitCode === null; attempt++) {
    try { serving = (await api("/api/health")).ok; } catch {}
    if (serving) break;
    await delay(300);
  }
  assert(serving, "Isolated packaged server did not start");
  const opened = await api("/api/auth/pairing", { method: "POST", body: JSON.stringify({ scopes: ["admin", "client"] }) });
  assert.equal(opened.status, 200, "Isolated admin pairing could not be opened");
  const { code } = await opened.json();
  const paired = await api("/api/auth/pair", { method: "POST", body: JSON.stringify({ code, label: "Codex verification" }) });
  assert.equal(paired.status, 200, "Isolated admin pairing failed");
  const { token } = await paired.json();
  const { bot } = await control(["new-bot", "--name", "Platform message read verification"]);
  await control(["set-model", "--bot", bot.id, "--instance", "codex-local", "--model", "gpt-5.6-sol"]);
  const capped = await api("/api/bots/" + bot.id, { method: "PATCH", body: JSON.stringify({ approvalCeiling: "ask" }) }, token);
  assert.equal(capped.status, 200, "Isolated bot permission change was refused");
  assert.equal((await capped.json()).bot.approvalCeiling, "ask");
  const cases = [
    {
      tool: "feishu_chat_history",
      args: { chat: feishuChatId, limit: 1, metadataOnly: true },
      expected: "FEISHU-READ-OK",
    },
    { tool: "inbox_recent_messages", args: { platform: "wechat", limit: 5 }, expected: "WX-CHECK-3815" },
    { tool: "inbox_recent_messages", args: { platform: "qq", limit: 5 }, expected: "QQ-CHECK-7204" },
  ];
  for (const test of cases) {
    const instruction = test.tool === "feishu_chat_history"
      ? "If it returned count 1, respond with FEISHU-READ-OK. Do not retry."
      : "Respond with the text of the single received message.";
    const { success } = await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text",
      "Call only the platform-messages MCP tool " + test.tool + " with these exact arguments: " +
      JSON.stringify(test.args) + ". " + instruction + " Do not use the shell or any other tool."]);
    assert(success, "Could not send verification request");
    let settled = await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "65"]);
    if (settled.status === "needs-user") {
      const { bots } = await (await api("/api/bots", {}, token)).json();
      const messages = bots.find(row => row.id === bot.id)?.messages ?? [];
      const card = messages.map(message => message.card).find(card => card?.requestId && !card.answered);
      assert(card, "No isolated tool approval card found");
      const details = JSON.stringify(card);
      assert(details.includes("platform-messages") && details.includes(test.tool), "Approval was for an unexpected tool");
      const approved = await api("/api/bots/" + bot.id + "/respond", { method: "POST", body: JSON.stringify({ threadId: bot.activeTaskId, requestId: card.requestId, behavior: "allow" }) }, token);
      assert.equal(approved.status, 200, "Isolated read-only tool approval failed");
      settled = await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "65"]);
    }
    assert.equal(settled.status, "settled", "Isolated Codex verification did not settle");
    const { bots } = await (await api("/api/bots", {}, token)).json();
    const messages = bots.find(row => row.id === bot.id)?.messages ?? [];
    const native = join(dataDir, "native");
    const frames = readdirSync(native).filter(file => file.endsWith(".ndjson")).flatMap(file =>
      readFileSync(join(native, file), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line).msg));
    const read = frames.map(frame => frame?.params?.item).filter(item =>
      item?.type === "mcpToolCall" && item.server === "platform-messages" && item.tool === test.tool &&
      item.status === "completed" && Object.entries(test.args).every(([key, value]) => item.arguments?.[key] === value)).at(-1);
    assert(read, "Codex did not complete the expected platform tool");
    const result = read.result?.content?.find(item => item?.type === "text")?.text;
    assert(result && typeof result === "string", "Platform tool result did not contain text");
    assert(!read.result.isError, result);
    const payload = JSON.parse(result);
    assert.equal(payload.count, 1);
    if (test.tool === "feishu_chat_history") assert(!("messages" in payload), "Feishu test leaked content");
    else assert.equal(payload.messages[0].text, test.expected);
    const answer = messages.filter(message => message.role === "bot" && typeof message.text === "string").at(-1)?.text ?? "";
    assert(answer.includes(test.expected), "Codex reply did not match the verified read");
    console.log(JSON.stringify({engine: "Sven Bots packaged Codex", tool: test.tool, platform: test.args.platform ?? "feishu", count: 1, synthetic: test.tool !== "feishu_chat_history"}));
  }
} finally {
  server.kill("SIGTERM");
  await Promise.race([waitClosed, delay(4_000, null, { ref: false })]);
  log.end();
}
