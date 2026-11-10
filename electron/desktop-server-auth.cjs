"use strict";

const DESKTOP_MUTATION_HEADER = "X-OpenMausBot-Desktop-Owner";

/** Chromium's webRequest hook cannot see Node fetch, so both paths add the owner capability here. */
function desktopServerHeaders(headers, { packaged, token }) {
  const next = { ...headers };
  if (!packaged) return next;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid desktop mutation capability");
  }
  next[DESKTOP_MUTATION_HEADER] = token;
  return next;
}

function createDesktopServerRequest({ port, packaged, token, ready }) {
  return async (route, init = {}) => {
    if (!ready()) throw new Error("not running");
    return fetch(`http://127.0.0.1:${port()}${route}`, {
      ...init,
      redirect: "error",
      credentials: "omit",
      headers: desktopServerHeaders(Object.fromEntries(new Headers(init.headers)), { packaged, token }),
    });
  };
}

module.exports = { DESKTOP_MUTATION_HEADER, desktopServerHeaders, createDesktopServerRequest };
