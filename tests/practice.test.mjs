import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import HanziWriter from "hanzi-writer";
import { validateAttempt } from "../src/domain.js";

const dom = new JSDOM('<main id="root"></main><div id="toast"></div>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "SVGElement",
  "MouseEvent",
])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
  dom.window,
);
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  get: () => 360,
});
const fixtures = Object.fromEntries(
  ["一", "二", "你"].map((char) => [
    char,
    JSON.parse(
      fs.readFileSync(new URL(`./fixtures/${char}.json`, import.meta.url)),
    ),
  ]),
);
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () =>
    fixtures[
      decodeURIComponent(String(url).split("/").at(-1).replace(".json", ""))
    ],
});
const { mountPractice, cleanupPractice } =
  await import("../src/activities/stroke-order.js");
const root = document.getElementById("root");
const waitFor = async (predicate) => {
  const end = Date.now() + 3000;
  while (!predicate() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(predicate(), root.querySelector("#practice-feedback")?.textContent);
};
function draw(char, offset = 0, strokes = fixtures[char].medians) {
  const svg = root.querySelector("#writer-target svg");
  const t = HanziWriter.getScalingTransform(360, 360, 360 * 0.12);
  for (const stroke of strokes) {
    stroke.forEach(([x, y], i) =>
      svg.dispatchEvent(
        new MouseEvent(i ? "mousemove" : "mousedown", {
          bubbles: true,
          clientX: t.x + (x + offset) * t.scale,
          clientY: 360 - t.y - y * t.scale,
        }),
      ),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }
}
function setup(char = "你", overrides = {}) {
  let attempts = 0,
    saved = 0;
  const calls = [];
  const assignment = {
    id: "a",
    title: "Practice",
    className: "",
    mode: "write",
    characters: [char],
    repetitions: 2,
  };
  const enrollment = { ...assignment, counts: [0], status: "in-progress" };
  const api = {
    async call(name, input) {
      calls.push({ name, input });
      if (name === "beginAttempt")
        return { attemptId: `attempt-${++attempts}` };
      if (name === "completeAttempt") {
        validateAttempt(char, input.paths, fixtures[char]);
        return { counts: [++saved] };
      }
    },
    async refresh() {},
    back() {},
    ...overrides,
  };
  return { assignment, enrollment, api, calls };
}
after(() => {
  cleanupPractice();
  dom.window.close();
});
test("dictionary lookup does not block writing and stale results cannot overwrite the next character", async () => {
  let resolveFirst;
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const s = setup("你", {
    lookupCharacter: (char) =>
      char === "你"
        ? first
        : Promise.resolve([{ pinyin: "èr", meanings: ["hai"] }]),
  });
  s.assignment.characters = ["你", "二"];
  s.enrollment.characters = ["你", "二"];
  s.enrollment.counts = [0, 0];
  await mountPractice(root, s.assignment, s.enrollment, s.api);
  assert.equal(root.querySelector("#redo-repetition").disabled, false);
  root.querySelector("#next-char").click();
  await waitFor(() =>
    root.querySelector("#character-info").textContent.includes("hai"),
  );
  resolveFirst([{ pinyin: "nǐ", meanings: ["bạn"] }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(root.querySelector("#character-info").textContent, /èr/);
  assert.doesNotMatch(root.querySelector("#character-info").textContent, /bạn/);
});
test("real writer stroke callbacks save a completed character and update repetitions", async () => {
  const s = setup();
  await mountPractice(root, s.assignment, s.enrollment, s.api);
  await new Promise((r) => setTimeout(r, 10));
  draw("你");
  await waitFor(
    () => root.querySelector("#repetition-count").textContent === "1 / 2",
  );
  assert.equal(s.calls.filter((c) => c.name === "completeAttempt").length, 1);
});
test("handwriting accepted by the quiz is recorded instead of failing a stricter save check", async () => {
  const s = setup("一");
  await mountPractice(root, s.assignment, s.enrollment, s.api);
  await new Promise((r) => setTimeout(r, 10));
  draw("一", 170);
  await waitFor(
    () => root.querySelector("#repetition-count").textContent === "1 / 2",
  );
});
test("Redo clears partial strokes and starts a fresh attempt without adding a count", async () => {
  const s = setup();
  await mountPractice(root, s.assignment, s.enrollment, s.api);
  draw("你", 0, fixtures["你"].medians.slice(0, 1));
  assert.equal(root.querySelector("#stroke-counter").textContent, "1 / 7");
  root.querySelector("#redo-repetition").click();
  await waitFor(() => !root.querySelector("#redo-repetition").disabled);
  assert.equal(root.querySelector("#stroke-counter").textContent, "0 / 7");
  assert.equal(root.querySelector("#repetition-count").textContent, "0 / 2");
  assert.equal(
    s.calls.filter((c) => c.name === "beginAttempt").at(-1).input.restart,
    true,
  );
  assert.equal(s.calls.filter((c) => c.name === "completeAttempt").length, 0);
  draw("你");
  await waitFor(
    () => root.querySelector("#repetition-count").textContent === "1 / 2",
  );
});
test("failed saves can be retried and a dashboard refresh error does not undo a saved count", async () => {
  const s = setup("一", {
    async refresh() {
      throw new Error("Offline refresh");
    },
  });
  const normalCall = s.api.call;
  let failed = false;
  s.api.call = async (name, input) => {
    if (name === "completeAttempt" && !failed) {
      failed = true;
      throw new Error("Network interrupted");
    }
    return normalCall(name, input);
  };
  await mountPractice(root, s.assignment, s.enrollment, s.api);
  draw("一");
  await waitFor(() => !root.querySelector("#retry-record").hidden);
  assert.equal(root.querySelector("#repetition-count").textContent, "0 / 2");
  assert.equal(root.querySelector("#redo-repetition").hidden, false);
  root.querySelector("#retry-record").click();
  await waitFor(() => !root.querySelector("#repeat-character").hidden);
  assert.equal(root.querySelector("#repetition-count").textContent, "1 / 2");
  assert.equal(root.querySelector("#retry-record").hidden, true);
  assert.equal(root.querySelector("#redo-repetition").hidden, true);
  root.querySelector("#repeat-character").click();
  await waitFor(() => !root.querySelector("#redo-repetition").disabled);
  assert.equal(root.querySelector("#repetition-count").textContent, "1 / 2");
  draw("一", 3);
  await waitFor(
    () => root.querySelector("#repetition-count").textContent === "2 / 2",
  );
  assert.equal(root.querySelector("#submit-work").disabled, false);
  assert.equal(root.querySelector("#repeat-character").hidden, true);
});
