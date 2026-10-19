import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSignInFlow,
  classroomSignInUrl,
  isAppBrowser,
  checkSignInStorage,
} from "../src/sign-in.js";

const authDomain = "chinese-teaching-tools.firebaseapp.com";
const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1";
function setup(options = {}) {
  const calls = [];
  const data = new Map();
  const location = {
    href: `https://chinese-teaching-tools.web.app/?join=KFL8Y72`,
    assign(url) {
      calls.push(["navigate", url]);
    },
  };
  const state = {
    authDomain,
    location,
    userAgent: safari,
    history: {
      replaceState(_a, _b, path) {
        location.href = new URL(path, location.href).href;
        calls.push(["replace", path]);
      },
    },
    storage: () => ({
      setItem: (k, v) => data.set(k, v),
      getItem: (k) => data.get(k),
      removeItem: (k) => data.delete(k),
    }),
    popup: async () => {
      calls.push(["popup"]);
    },
    redirect: async () => {
      calls.push(["redirect", location.href]);
    },
    redirectResult: async () => {
      calls.push(["result"]);
    },
    authReady: async () => {},
    currentUser: () => null,
    ...options,
  };
  return { flow: createSignInFlow(state), calls, state };
}
test("iPhone sign-in moves to the matching domain before starting OAuth", async () => {
  const s = setup();
  await s.flow.login();
  assert.deepEqual(s.calls, [
    ["navigate", `https://${authDomain}/?join=KFL8Y72&signin=1`],
  ]);
});
test("matching-domain arrival consumes intent once and starts same-origin redirect", async () => {
  const s = setup();
  s.state.location.href = `https://${authDomain}/?join=KFL8Y72&signin=1`;
  await s.flow.finish();
  assert.deepEqual(s.calls, [
    ["replace", "/?join=KFL8Y72"],
    ["result"],
    ["redirect", `https://${authDomain}/?join=KFL8Y72`],
  ]);
  s.calls.length = 0;
  await s.flow.finish();
  assert.deepEqual(s.calls, [["result"]]);
});
test("direct iPhone sign-in on the matching domain needs no extra navigation", async () => {
  const s = setup();
  s.state.location.href = `https://${authDomain}/`;
  await s.flow.login();
  assert.deepEqual(s.calls, [["redirect", `https://${authDomain}/`]]);
});
test("LINE is recognized while normal iPhone Safari is allowed", async () => {
  assert.equal(isAppBrowser(safari), false);
  assert.equal(isAppBrowser(safari + " Line/15.0.0"), true);
  const s = setup({ userAgent: safari + " Line/15.0.0" });
  await assert.rejects(s.flow.login(), /Safari or Chrome/);
  assert.deepEqual(s.calls, []);
});
test("desktop popup continues to work", async () => {
  const s = setup({
    userAgent: "Mozilla/5.0 Macintosh Chrome/132 Safari/537.36",
  });
  await s.flow.login();
  assert.deepEqual(s.calls, [["popup"]]);
});
test("blocked desktop popup never redirects Google from the wrong origin", async () => {
  const s = setup({
    userAgent: "Macintosh Chrome",
    popup: async () => {
      throw { code: "auth/popup-blocked" };
    },
  });
  await s.flow.login();
  assert.equal(s.calls[0][0], "navigate");
  assert.equal(new URL(s.calls[0][1]).hostname, authDomain);
});
test("closing a popup does not launch an unexpected redirect", async () => {
  const s = setup({
    userAgent: "Macintosh Chrome",
    popup: async () => {
      throw { code: "auth/popup-closed-by-user" };
    },
  });
  await assert.rejects(s.flow.login());
  assert.deepEqual(s.calls, []);
});
test("blocked storage produces a useful error before Google is opened", async () => {
  const s = setup({
    storage: () => {
      throw new Error("SecurityError");
    },
  });
  s.state.location.href = `https://${authDomain}/`;
  await assert.rejects(s.flow.login(), /cannot save the sign-in session/);
  assert.deepEqual(s.calls, []);
  assert.throws(
    () =>
      checkSignInStorage({
        setItem() {},
        getItem() {
          return null;
        },
        removeItem() {},
      }),
    /cannot save/,
  );
});
test("existing signed-in users are not redirected again", async () => {
  const s = setup({ currentUser: () => ({ uid: "teacher" }) });
  s.state.location.href = `https://${authDomain}/?signin=1`;
  await s.flow.finish();
  assert.deepEqual(s.calls, [["replace", "/"], ["result"]]);
});
test("redirect errors are exposed and the auto-start flag is still cleared", async () => {
  const s = setup({
    redirectResult: async () => {
      throw Error("Redirect failed");
    },
  });
  s.state.location.href = `https://${authDomain}/?signin=1`;
  await assert.rejects(s.flow.finish(), /Redirect failed/);
  assert.equal(
    new URL(s.state.location.href).searchParams.has("signin"),
    false,
  );
  assert.equal(
    s.calls.some((c) => c[0] === "redirect"),
    false,
  );
});
test("sign-in links retain an assignment code and discard arbitrary destinations and OAuth state", () => {
  assert.equal(
    classroomSignInUrl(
      "https://chinese-teaching-tools.web.app/?join=KFL8Y72&next=https://evil.example&code=secret#token",
      authDomain,
    ),
    `https://${authDomain}/?join=KFL8Y72`,
  );
  assert.equal(
    classroomSignInUrl(
      "https://chinese-teaching-tools.web.app/?join=invalid-code",
      authDomain,
    ),
    `https://${authDomain}/`,
  );
});
test("local emulator login stays local", async () => {
  const s = setup({ local: true });
  s.state.location.href = "http://127.0.0.1:4180/";
  await s.flow.login();
  assert.deepEqual(s.calls, [["popup"]]);
});
