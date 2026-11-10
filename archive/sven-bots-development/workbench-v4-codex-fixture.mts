import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runControlOmb } from "./OpenMausBot/scripts/control-omb.ts";
const fixtures = [createServer(), createServer()];
await Promise.all(fixtures.map(server => new Promise<void>(done => server.listen(0, "127.0.0.1", done))));
const [port, webhookPort] = fixtures.map(server => server.address().port);
await Promise.all(fixtures.map(server => new Promise<void>(done => server.close(() => done()))));
const home = process.env.HOME;
const dataDir = mkdtempSync(resolve("../workbench-v4-codex-fixture-"));
const log = createWriteStream(resolve("../workbench-v4-codex-fixture.log"), { flags: "w", mode: 0o600 });
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  instances: { "codex-local": { driver: "codex", config: { cli: join(home, ".local/bin/codex") } } },
  defaultModelSelection: { instanceId: "codex-local", model: "gpt-5.6-sol" },
}), { mode: 0o600 });
const bundle = resolve("release/mac-arm64/Agent Workbench.app/Contents/Resources");
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
  const { bot } = await control(["new-bot", "--name", "Workbench Codex verification"]);
  await control(["set-model", "--bot", bot.id, "--instance", "codex-local", "--model", "gpt-5.6-sol"]);
  const capped = await api("/api/bots/" + bot.id, { method: "PATCH", body: JSON.stringify({ approvalCeiling: "ask" }) }, token);
  assert.equal(capped.status, 200, "Isolated bot permission change was refused");
  assert.equal((await capped.json()).bot.approvalCeiling, "ask");
  const { success } = await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Reply with exactly WORKBENCH_CODEX_READY. Do not use any tools."]);
  assert(success, "Could not send verification request");
  const settled = await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "45"]);
  assert.equal(settled.status, "settled");
  const { bots } = await (await api("/api/bots", {}, token)).json();
  const messages = bots.find(row => row.id === bot.id)?.messages ?? [];
  assert(messages.some(message => message.role === "bot" && message.text?.trim() === "WORKBENCH_CODEX_READY"), "Expected Codex reply not found");
  const saved = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")).find(row => row.id === bot.id);
  assert.equal(saved.approvalCeiling, "ask");
  console.log("packaged Codex on gpt-5.6-sol returned WORKBENCH_CODEX_READY, approval ceiling ask");
} finally {
  server.kill("SIGTERM");
  await Promise.race([waitClosed, delay(4_000, null, { ref: false })]);
  log.end();
}
