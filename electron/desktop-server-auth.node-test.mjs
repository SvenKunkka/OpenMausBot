import assert from "node:assert/strict";
import { test } from "node:test";

import authModule from "./desktop-server-auth.cjs";

const { DESKTOP_MUTATION_HEADER, desktopServerHeaders, createDesktopServerRequest } = authModule;
const TOKEN = "a".repeat(43);

test("adds the owner capability to packaged main-process mutations", () => {
  assert.deepEqual(desktopServerHeaders(
    { "content-type": "application/json" },
    { packaged: true, token: TOKEN },
  ), {
    "content-type": "application/json",
    [DESKTOP_MUTATION_HEADER]: TOKEN,
  });
});

test("leaves development requests unchanged and rejects bad packaged tokens", () => {
  assert.deepEqual(desktopServerHeaders({ accept: "application/json" }, {
    packaged: false,
    token: "",
  }), { accept: "application/json" });
  assert.throws(() => desktopServerHeaders({}, { packaged: true, token: "short" }), /invalid/);
});

test("uses the active local server port without forwarding the capability to a redirect", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response());
  let port = 8799;
  let ready = false;
  const request = createDesktopServerRequest({ port: () => port, packaged: true, token: TOKEN, ready: () => ready });

  await assert.rejects(request("/api/bots"), /not running/);
  assert.equal(fetch.mock.callCount(), 0);
  ready = true;
  await request("/api/bots");
  port = 8800;
  await request("/api/config", { headers: new Headers({ accept: "application/json" }) });

  assert.equal(fetch.mock.calls[0].arguments[0], "http://127.0.0.1:8799/api/bots");
  assert.deepEqual(fetch.mock.calls[1].arguments, [
    "http://127.0.0.1:8800/api/config",
    { redirect: "error", credentials: "omit", headers: { accept: "application/json", [DESKTOP_MUTATION_HEADER]: TOKEN } },
  ]);
});
