import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, createWriteStream, readdirSync } from "node:fs";
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
const dataDir = mkdtempSync(resolve("../sven-bots-github-fixture-"));
const log = createWriteStream(resolve("../sven-bots-github-fixture.log"), { flags: "w", mode: 0o600 });
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  instances: { "codex-local": { driver: "codex", config: { cli: join(home, ".local/bin/codex") } } },
  defaultModelSelection: { instanceId: "codex-local", model: "gpt-5.6-sol" },
  mcpServers: { "github-readonly": { command: "/opt/homebrew/bin/python3", args: [resolve("../sven-bots-integrations/github-readonly.py")], enabled: true } },
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
  const { bot } = await control(["new-bot", "--name", "GitHub private-read verification"]);
  await control(["set-model", "--bot", bot.id, "--instance", "codex-local", "--model", "gpt-5.6-sol"]);
  const capped = await api("/api/bots/" + bot.id, { method: "PATCH", body: JSON.stringify({ approvalCeiling: "ask" }) }, token);
  assert.equal(capped.status, 200, "Isolated bot permission change was refused");
  assert.equal((await capped.json()).bot.approvalCeiling, "ask");
  const { success } = await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text",
    "This is an isolated read-only connector test. Call only the github-readonly MCP tool github_read_file with path README.md. Use its actual result to report the first Markdown heading and the Git blob SHA. Do not use shell, web, another tool, or any write operation."]);
  assert(success, "Could not send verification request");
  let settled = await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "45"]);
  if (settled.status === "needs-user") {
    const response = await api("/api/bots", {}, token);
    const { bots } = await response.json();
    const messages = bots.find(row => row.id === bot.id)?.messages ?? [];
    const card = messages.map(message => message.card).find(card => card?.requestId && !card.answered);
    assert(card, "No isolated tool approval card found");
    const details = JSON.stringify(card);
    assert(details.includes("github-readonly") && details.includes("github_read_file"), "Approval was for an unexpected tool");
    const approved = await api("/api/bots/" + bot.id + "/respond", { method: "POST", body: JSON.stringify({ threadId: bot.activeTaskId, requestId: card.requestId, behavior: "allow" }) }, token);
    assert.equal(approved.status, 200, "Isolated read-only tool approval failed");
    settled = await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "45"]);
  }
  assert.equal(settled.status, "settled", "Isolated Codex verification did not settle");
  const { bots } = await (await api("/api/bots", {}, token)).json();
  const messages = bots.find(row => row.id === bot.id)?.messages ?? [];
  const native = join(dataDir, "native");
  const frames = readdirSync(native).filter(file => file.endsWith(".ndjson")).flatMap(file =>
    readFileSync(join(native, file), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line).msg));
  const read = frames.map(frame => frame?.params?.item).filter(item => item?.type === "mcpToolCall" && item.server === "github-readonly" && item.tool === "github_read_file")
    .find(item => item.status === "completed");
  assert(read, "Codex did not complete the GitHub file tool");
  const result = read.result?.content?.find(item => item?.type === "text")?.text;
  assert(result && typeof result === "string", "GitHub tool result did not contain text");
  const payload = JSON.parse(result);
  assert.equal(payload.repository, "SvenKunkka/OpenMausBot");
  assert.equal(payload.path, "README.md");
  assert.equal(payload.content.split("\n")[0], "# Sven Bots");
  const answer = messages.filter(message => message.role === "bot" && typeof message.text === "string").at(-1)?.text ?? "";
  assert(answer.includes(payload.blobSha) && answer.includes("Sven Bots"), "Codex reply did not match the verified GitHub read");
  console.log(JSON.stringify({engine:"Sven Bots packaged Codex",tool:"github-readonly/github_read_file",repository:payload.repository,path:payload.path,heading:payload.content.split("\n")[0],blobSha:payload.blobSha,approvalCeiling:"ask"}));
} finally {
  server.kill("SIGTERM");
  await Promise.race([waitClosed, delay(4_000, null, { ref: false })]);
  log.end();
}
