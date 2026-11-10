import assert from "node:assert/strict";
import { approvalModeFor, setDefaultApprovalMode } from "./OpenMausBot-source/shared/approval-mode.ts";
import { detectBox } from "./OpenMausBot-source/server/bot-box/detect.ts";
import { resolveLoopbackTrust, resolveRequestAuth } from "./OpenMausBot-source/server/request-auth.ts";

const tests: Array<[string, () => void]> = [];
function check(name: string, test: () => void) { tests.push([name, test]); }

const sessions = {
  authenticate: () => null,
  redeemStreamTicket: () => null,
};
function request(method: string, path: string, settings: Record<string, unknown> = {},
                 headers: Record<string, string> = {}, address = "127.0.0.1") {
  return resolveRequestAuth(
    { method, headers: { host: "localhost:8799", ...headers }, socket: { remoteAddress: address } } as never,
    { sessions, cookieName: "fixture", streamPath: "/api/stream", url: new URL(path, "http://localhost:8799"), ...settings } as never,
  );
}
const desktop = { loopbackMutationToken: "fixture-only" };
const service = { loopbackTrust: "service" };

check("ordinary new bot defaults to full", () => assert.equal(approvalModeFor({}), "full"));
check("explicit Ask and unfinished grant fail closed to Ask", () => {
  assert.equal(approvalModeFor({ approvalMode: "ask" }), "ask");
  assert.equal(approvalModeFor({ approvalMode: "full", approvalGrant: { id: "fixture" } }), "ask");
});
check("hosted default can be set to Ask", () => {
  setDefaultApprovalMode("ask");
  assert.equal(approvalModeFor({}), "ask");
  setDefaultApprovalMode("full");
});
check("independent box off by default on desktop or ordinary Linux", () => {
  assert.equal(detectBox({ env: {}, platform: "darwin" }).box, "off");
  assert.equal(detectBox({ env: {}, platform: "linux" }).reason, "not-cloud");
  assert.equal(detectBox({ env: { OMB_BOT_BOX: "1" }, platform: "darwin" }).reason, "not-linux");
});
check("Linux cloud can enable bubblewrap with a successful mocked probe", () => {
  assert.equal(detectBox({
    env: { OMB_CLOUD_ROLE: "home" }, platform: "linux",
    which: (name) => `/fixture/${name}`, probe: () => true,
  }).box, "bwrap");
});
check("desktop loopback with no credential reaches history and attachments authorization", () => {
  for (const path of ["/api/bots", "/api/threads/fixture/messages", "/api/attachments/fixture.png"]) {
    assert.equal(request("GET", path, desktop).auth?.kind, "loopback");
  }
});
check("desktop loopback with no credential cannot patch config", () => {
  assert.equal(request("PATCH", "/api/config", desktop).status, 403);
  assert.equal(request("PATCH", "/api/config", desktop).auth, null);
});
check("external origin, browser fetch and a LAN peer cannot use local trust", () => {
  assert.equal(request("GET", "/api/bots", desktop, { origin: "https://example.invalid" }).auth, null);
  assert.equal(request("GET", "/api/bots", desktop, { "sec-fetch-site": "same-origin" }).auth, null);
  assert.equal(request("GET", "/api/bots", desktop, {}, "192.0.2.10").auth, null);
});
check("unpaired service reaches guarded relay routes but cannot patch config", () => {
  for (const path of ["/api/bots/fixture/tasks", "/api/bots/fixture/messages/guarded"]) {
    const auth = request("POST", path, service).auth;
    assert.equal(auth?.kind, "loopback");
    assert.deepEqual(auth?.scopes, ["client"]);
  }
  assert.equal(request("PATCH", "/api/config", service).auth, null);
});
check("headless owner mode grants loopback admin scope", () => {
  assert.equal(resolveLoopbackTrust({ env: {}, desktopManaged: false, hostedWorkspace: false }).trust, "owner");
  assert.deepEqual(request("PATCH", "/api/config", { loopbackTrust: "owner" }).auth?.scopes, ["admin", "client"]);
});
check("expired presented token cannot fall through to loopback owner", () => {
  assert.equal(request("GET", "/api/bots", desktop, { authorization: "Bearer omb_sess_fixture" }).auth, null);
});

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`${tests.length}/${tests.length} checks passed`);
