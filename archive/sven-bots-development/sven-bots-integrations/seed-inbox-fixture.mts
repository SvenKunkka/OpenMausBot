import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Inbox } from "../../../https-github-com-ronglecat-grok-bot/work/bot-inbox/gateway/inbox/store.ts";
import { importShareBatches } from "../../../https-github-com-ronglecat-grok-bot/work/bot-inbox/connectors/wechat-share/import.mjs";
import { createQQConnector } from "../../../https-github-com-ronglecat-grok-bot/work/bot-inbox/connectors/qq/index.ts";

const root = process.argv[2];
assert(root, "Pass the isolated fixture root");
const store = new Inbox(root);
try {
  const batchId = randomUUID();
  const share = join(root, "share");
  await mkdir(join(share, batchId), { recursive: true, mode: 0o700 });
  await writeFile(join(share, batchId, "manifest.json"), JSON.stringify({
    version: 1, id: batchId, text: "WX-CHECK-3815", attachments: [],
  }), { mode: 0o600 });
  const imported = await importShareBatches({ root: share, accept: event => { store.receive(event); } });
  assert.deepEqual(imported, { accepted: [batchId], failed: [] });
  const appId = "synthetic-qq-bot";
  const clientSecret = "fixture-only-secret";
  const qq = createQQConnector({ appId, clientSecret });
  const seed = Buffer.from(clientSecret.repeat(Math.ceil(32 / clientSecret.length))).subarray(0, 32);
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8",
  });
  const raw = Buffer.from(JSON.stringify({
    op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "qq-fixture", content: "QQ-CHECK-7204", author: { user_openid: "synthetic-sender" } },
  }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "x-bot-appid": appId, "x-signature-timestamp": timestamp,
    "x-signature-ed25519": sign(null, Buffer.concat([Buffer.from(timestamp), raw]), privateKey).toString("hex"),
  });
  assert.equal((await qq.webhook(new Headers(), raw, () => assert.fail("Accepted unsigned callback"))).status, 401);
  const response = await qq.webhook(headers, raw, event => { store.receive(event); });
  assert.deepEqual(response, { status: 200, body: { op: 12, d: 0 } });
  store.receive({ channel: "desktop", accountId: "local", text: "NON-PLATFORM-DRAFT" });
  assert.deepEqual(store.list().map(row => row.channel).sort(), ["desktop", "qq", "wechat-share"]);
} finally {
  store.close();
}
