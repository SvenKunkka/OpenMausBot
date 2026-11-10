import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BindStatus, buildConnectUrl, createBindTask, decryptSecret, pollBindResult } from "./vendor-qq/package/dist/lib/qqbot-session.js";

const require = createRequire(import.meta.url);
const qrcode = require("/opt/homebrew/lib/node_modules/openclaw/node_modules/qrcode");
const platform = process.argv[2];
const image = process.argv[3];
const storage = join(homedir(), ".openmausbot", "platform-intake");
const binding = join(storage, platform + ".json");
const wechatBase = "https://ilinkai.weixin.qq.com";
const appHeaders = { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "196609" };

function wechatOrigin(candidate) {
  const url = new URL(candidate || wechatBase);
  if (url.protocol !== "https:" || !/^ilinkai(?:-[a-z0-9-]+)?\.weixin\.qq\.com$/i.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("WECHAT_ORIGIN_UNEXPECTED");
  }
  return url.origin;
}

async function request(url, options = {}, timeout = 12000) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("PLATFORM_HTTP_" + response.status);
  return await response.json();
}

async function showQr(value) {
  if (typeof value !== "string" || !value || value.length > 2048) throw new Error("QR_INVALID");
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)qq\.com$/i.test(url.hostname) || url.username || url.password || url.port) {
    throw new Error("QR_ORIGIN_UNEXPECTED");
  }
  await mkdir(dirname(image), { recursive: true });
  const png = await qrcode.toBuffer(value, { margin: 4, width: 640 });
  await writeFile(image, png, { mode: 0o600 });
  console.log(platform + ": QR_READY");
}

async function bindWechat() {
  const qr = await request(wechatBase + "/ilink/bot/get_bot_qrcode?bot_type=3", {
    method: "POST",
    headers: { ...appHeaders, "Content-Type": "application/json", AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE())).toString("base64") },
    body: JSON.stringify({ local_token_list: [] }),
  });
  if (!qr.qrcode || !qr.qrcode_img_content) throw new Error("WECHAT_QR_UNAVAILABLE");
  await showQr(qr.qrcode_img_content);
  let origin = wechatBase;
  let lastStatus = "";
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = new URL("/ilink/bot/get_qrcode_status", origin);
    url.searchParams.set("qrcode", qr.qrcode);
    const status = await request(url, { headers: appHeaders }, 40000).catch(() => ({ status: "wait" }));
    if (status.status === "confirmed") {
      if (![status.bot_token, status.ilink_bot_id, status.ilink_user_id].every(value => typeof value === "string" && value.length)) {
        throw new Error("WECHAT_BINDING_INCOMPLETE");
      }
      return {
        token: status.bot_token, account: status.ilink_bot_id, owner: status.ilink_user_id,
        baseUrl: wechatOrigin(status.baseurl), boundAt: Date.now(),
      };
    }
    if (status.status === "scaned_but_redirect") origin = wechatOrigin("https://" + status.redirect_host);
    if (status.status === "expired" || status.status === "binded_redirect") throw new Error("WECHAT_" + status.status.toUpperCase());
    if (status.status?.includes("need_verifycode")) throw new Error("WECHAT_PIN_NEEDED");
    if (status.status === "scaned" && lastStatus !== "scaned") console.log("wechat: SCANNED");
    lastStatus = status.status;
    await delay(1300);
  }
  throw new Error("WECHAT_SCAN_TIMED_OUT");
}

async function bindQQ() {
  const { taskId, key } = await createBindTask();
  await showQr(buildConnectUrl(taskId));
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const result = await pollBindResult(taskId).catch(() => null);
    if (result?.status === BindStatus.COMPLETED) {
      const secret = decryptSecret(result.botEncryptSecret, key);
      if (!/^\d+$/.test(result.botAppId) || !secret) throw new Error("QQ_BINDING_INCOMPLETE");
      return { appId: result.botAppId, secret, boundAt: Date.now() };
    }
    if (result?.status === BindStatus.EXPIRED) throw new Error("QQ_QR_EXPIRED");
    await delay(2000);
  }
  throw new Error("QQ_SCAN_TIMED_OUT");
}

try {
  if (!["wechat", "qq"].includes(platform) || !image) throw new Error("PLATFORM_BIND_USAGE");
  await mkdir(storage, { mode: 0o700 });
} catch (error) {
  if (error?.code !== "EEXIST") {
    console.error(platform + ": BIND_START_FAILED");
    process.exit(1);
  }
}
try {
  const directory = await lstat(storage);
  if (!directory.isDirectory() || directory.uid !== process.getuid()) throw new Error("BIND_STORAGE_INVALID");
  await chmod(storage, 0o700);
  if (await lstat(binding).then(() => true, () => false)) throw new Error("BINDING_ALREADY_PRESENT");
  const credentials = await (platform === "wechat" ? bindWechat() : bindQQ());
  await writeFile(binding, JSON.stringify(credentials) + "\n", { mode: 0o600, flag: "wx" });
  console.log(platform + ": BOUND");
} catch (error) {
  const code = String(error?.message);
  console.error(platform + ": " + (/^[A-Z_0-9]+$/.test(code) ? code : "BIND_FAILED"));
  process.exitCode = 1;
}
