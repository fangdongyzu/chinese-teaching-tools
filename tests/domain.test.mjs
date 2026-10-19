import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  OWNERS,
  email,
  normalizeAssignment,
  validateAttempt,
  canSubmit,
  fingerprint,
} from "../src/domain.js";
const data = (char) =>
  JSON.parse(
    fs.readFileSync(new URL(`./fixtures/${char}.json`, import.meta.url)),
  );
const input = {
  activityType: "stroke-order",
  title: "Week one",
  text: "你，好！你 学習ABC🙂",
  repetitions: 3,
  mode: "write",
  dueAt: null,
  studentEmails: ["Student@Example.com"],
};
test("both requested teacher accounts remain owners", () =>
  assert.deepEqual(OWNERS, [
    "tristanlpd@gm.lhu.edu.tw",
    "tristanlpd@gmail.com",
  ]));
test("mixed text is filtered and repeated characters share a quota", () => {
  const a = normalizeAssignment(input);
  assert.deepEqual(a.characters, ["你", "好", "学", "習"]);
  assert.deepEqual(a.studentEmails, ["student@example.com"]);
});
test("repetitions must be whole numbers from 1 to 50", () => {
  for (const repetitions of [0, -1, 1.5, 51, "3", NaN])
    assert.throws(() => normalizeAssignment({ ...input, repetitions }));
});
test("invalid assignments, modes, rosters and deadlines are rejected", () => {
  for (const change of [
    { text: "abc🙂" },
    { activityType: "custom" },
    { mode: "other" },
    { dueAt: 1 },
    { studentEmails: ["invalid"] },
  ])
    assert.throws(() => normalizeAssignment({ ...input, ...change }));
  assert.throws(() => email("a/b@example.com"));
});
test("normal handwriting variation is accepted by browser validation", () => {
  const d = data("你");
  const paths = d.medians.map((p) =>
    p.map(([x, y], i) => [x + Math.sin(i) * 13, y + Math.cos(i) * 10]),
  );
  assert.equal(validateAttempt("你", paths, d).strokeCount, 7);
});
test("backward and out of order strokes are rejected by browser validation", () => {
  assert.throws(() =>
    validateAttempt(
      "一",
      [data("一").medians[0].slice().reverse()],
      data("一"),
    ),
  );
  assert.throws(() =>
    validateAttempt("二", data("二").medians.slice().reverse(), data("二")),
  );
});
test("missing, malformed and non-finite paths are rejected", () => {
  for (const paths of [
    [],
    [
      [
        [NaN, 1],
        [2, 3],
      ],
    ],
    [
      [
        [Infinity, 0],
        [1, 1],
      ],
    ],
    [
      [
        [99999, 0],
        [1, 1],
      ],
    ],
  ])
    assert.throws(() => validateAttempt("你", paths, data("你")));
});
test("fingerprints detect exact repetition reuse in the normal app", async () => {
  const d = data("一");
  const a = validateAttempt("一", d.medians, d);
  const b = validateAttempt(
    "一",
    d.medians.map((p) => p.map(([x, y]) => [x + 2, y])),
    d,
  );
  assert.equal(
    await fingerprint("一", a.strokes),
    await fingerprint("一", a.strokes),
  );
  assert.notEqual(
    await fingerprint("一", a.strokes),
    await fingerprint("一", b.strokes),
  );
});
test("all quotas are required before submission", () => {
  assert.equal(canSubmit([2, 3], ["你", "好"], 3), false);
  assert.equal(canSubmit([3], ["你", "好"], 3), false);
  assert.equal(canSubmit(["3", 3], ["你", "好"], 3), false);
  assert.equal(canSubmit([3, 3], ["你", "好"], 3), true);
});
