const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  googleIdentity,
  email,
  normalizeAssignment,
  validateAttempt,
  charData,
  canSubmit,
  OWNERS,
} = require("../activities/stroke-order.cjs");
const input = {
  activityType: "stroke-order",
  title: "Week one",
  text: "你，好！你 学習ABC🙂",
  repetitions: 3,
  mode: "write",
  dueAt: null,
  studentEmails: ["Student@Example.com"],
  instructions: "",
  className: "Chinese 101",
};
test("both requested teacher accounts are initial owners", () =>
  assert.deepEqual(OWNERS, [
    "tristanlpd@gm.lhu.edu.tw",
    "tristanlpd@gmail.com",
  ]));
test("verified Google sign-in is mandatory", () => {
  assert.throws(() => googleIdentity(null), /Sign in/);
  assert.throws(
    () =>
      googleIdentity({
        uid: "x",
        token: {
          email: "x@example.com",
          email_verified: false,
          firebase: { sign_in_provider: "google.com" },
        },
      }),
    /verified/,
  );
  assert.throws(
    () =>
      googleIdentity({
        uid: "x",
        token: {
          email: "x@example.com",
          email_verified: true,
          firebase: { sign_in_provider: "password" },
        },
      }),
    /verified/,
  );
  assert.equal(
    googleIdentity({
      uid: "x",
      token: {
        email: "X@example.com",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      },
    }).email,
    "x@example.com",
  );
});
test("normalize mixed text and deduplicate practice quota", () => {
  const a = normalizeAssignment(input);
  assert.deepEqual(a.characters, ["你", "好", "学", "習"]);
  assert.equal(a.repetitions, 3);
  assert.deepEqual(a.studentEmails, ["student@example.com"]);
});
test("repetitions must be an integer in the allowed range", () => {
  for (const repetitions of [0, -1, 1.5, 51, "3", NaN])
    assert.throws(() => normalizeAssignment({ ...input, repetitions }));
});
test("blank passages and unavailable characters cannot create impossible assignments", () => {
  assert.throws(() => normalizeAssignment({ ...input, text: "abc🙂" }));
  assert.throws(
    () => normalizeAssignment({ ...input, text: "𰻞" }),
    /unavailable/,
  );
});
test("unsupported activity and mode are rejected", () => {
  assert.throws(() =>
    normalizeAssignment({ ...input, activityType: "custom" }),
  );
  assert.throws(() => normalizeAssignment({ ...input, mode: "anything" }));
});
test("past due dates and invalid rosters are rejected", () => {
  assert.throws(() => normalizeAssignment({ ...input, dueAt: 1 }));
  assert.throws(() =>
    normalizeAssignment({ ...input, studentEmails: ["invalid"] }),
  );
  assert.throws(() => email("a/b@example.com"));
});
test("server accepts ordered stroke medians with normal hand variation", () => {
  const paths = charData("你").medians.map((p) =>
    p.map(([x, y], i) => [x + Math.sin(i) * 13, y + Math.cos(i) * 10]),
  );
  assert.equal(validateAttempt("你", paths).strokeCount, 7);
});
test("server rejects backward strokes", () =>
  assert.throws(
    () => validateAttempt("一", [charData("一").medians[0].slice().reverse()]),
    /direction|match/,
  ));
test("server rejects out of order strokes", () =>
  assert.throws(() =>
    validateAttempt("二", charData("二").medians.slice().reverse()),
  ));
test("server rejects missing, extra, malformed and non-finite paths", () => {
  for (const paths of [
    [],
    [
      [
        [0, 0],
        [1, 1],
      ],
    ],
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
    assert.throws(() => validateAttempt("你", paths));
});
test("the same path has a stable replay fingerprint, a new path differs", () => {
  const paths = charData("一").medians;
  const a = validateAttempt("一", paths),
    b = validateAttempt("一", paths),
    c = validateAttempt(
      "一",
      paths.map((p) => p.map(([x, y]) => [x + 2, y])),
    );
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});
test("cannot submit until every character has the required repetitions", () => {
  assert.equal(canSubmit([2, 3], ["你", "好"], 3), false);
  assert.equal(canSubmit([3], ["你", "好"], 3), false);
  assert.equal(canSubmit(["3", 3], ["你", "好"], 3), false);
  assert.equal(canSubmit([3, 3], ["你", "好"], 3), true);
});
