"use strict";
const { createHash } = require("node:crypto");
class ValidationError extends Error {
  constructor(message, code = "invalid-argument") {
    super(message);
    this.code = code;
  }
}
const fail = (message, code) => {
  throw new ValidationError(message, code);
};
const OWNERS = Object.freeze([
  "tristanlpd@gm.lhu.edu.tw",
  "tristanlpd@gmail.com",
]);
function email(value) {
  if (
    typeof value !== "string" ||
    !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value.trim()) ||
    value.length > 254
  )
    fail("Enter a valid email address.");
  return value.trim().toLowerCase();
}
function googleIdentity(auth) {
  if (!auth || !auth.uid)
    fail("Sign in with Google to continue.", "unauthenticated");
  if (
    !auth.token?.email_verified ||
    auth.token.firebase?.sign_in_provider !== "google.com"
  )
    fail("A verified Google account is required.", "permission-denied");
  return {
    uid: auth.uid,
    email: email(auth.token.email),
    name: String(auth.token.name || auth.token.email).slice(0, 120),
    photoURL: String(auth.token.picture || "").slice(0, 1000),
  };
}
function charData(char) {
  if (typeof char !== "string" || !/^\p{Script=Han}$/u.test(char))
    fail("Invalid Chinese character.");
  try {
    return require(`hanzi-writer-data/${char}.json`);
  } catch {
    fail(
      `Stroke data is unavailable for “${char}”. Remove it from this assignment.`,
    );
  }
}
function normalizeAssignment(input, now = Date.now()) {
  if (!input || typeof input !== "object")
    fail("Assignment details are required.");
  if (input.activityType !== "stroke-order")
    fail("This activity is not available.");
  const title = String(input.title || "").trim();
  if (title.length < 2 || title.length > 120)
    fail("Use a title between 2 and 120 characters.");
  const text = String(input.text || "").trim();
  if (text.length > 10000) fail("The passage is too long.");
  const characters = [
    ...new Set(Array.from(text).filter((c) => /\p{Script=Han}/u.test(c))),
  ];
  if (!characters.length || characters.length > 80)
    fail(
      "Use between 1 and 80 different Chinese characters. Repeated characters share a practice quota.",
    );
  characters.forEach(charData);
  const repetitions = input.repetitions;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 50)
    fail("Repetitions must be a whole number from 1 to 50.");
  const mode = input.mode;
  if (!["trace", "write"].includes(mode))
    fail("Choose guided tracing or writing from memory.");
  const dueAt = input.dueAt == null ? null : Number(input.dueAt);
  if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= now))
    fail("Choose a future due date.");
  if (!Array.isArray(input.studentEmails) || input.studentEmails.length > 200)
    fail("Use up to 200 student email addresses.");
  const studentEmails = [...new Set(input.studentEmails.map(email))];
  return {
    title,
    text,
    characters,
    repetitions,
    mode,
    dueAt,
    studentEmails,
    activityType: "stroke-order",
    instructions: String(input.instructions || "")
      .trim()
      .slice(0, 2000),
    className: String(input.className || "")
      .trim()
      .slice(0, 100),
  };
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathLength = (p) =>
  p.slice(1).reduce((sum, point, i) => sum + distance(p[i], point), 0);
function resample(path, count = 24) {
  const total = pathLength(path);
  if (total < 1) fail("A stroke needs a visible movement.");
  const result = [path[0]];
  let segment = 1,
    before = 0;
  for (let i = 1; i < count - 1; i++) {
    const target = (total * i) / (count - 1);
    while (
      segment < path.length - 1 &&
      before + distance(path[segment - 1], path[segment]) < target
    ) {
      before += distance(path[segment - 1], path[segment]);
      segment++;
    }
    const a = path[segment - 1],
      b = path[segment];
    const fraction = Math.min(1, (target - before) / (distance(a, b) || 1));
    result.push([
      a[0] + (b[0] - a[0]) * fraction,
      a[1] + (b[1] - a[1]) * fraction,
    ]);
  }
  result.push(path.at(-1));
  return result;
}
function validateAttempt(char, paths) {
  const data = charData(char);
  if (!Array.isArray(paths) || paths.length !== data.medians.length)
    fail("Complete every stroke in order before saving.");
  const normalized = paths.map((path, index) => {
    if (!Array.isArray(path) || path.length < 2 || path.length > 512)
      fail("Invalid stroke path.");
    if (
      path.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some(
            (v) =>
              typeof v !== "number" ||
              !Number.isFinite(v) ||
              v < -200 ||
              v > 1250,
          ),
      )
    )
      fail("Invalid stroke coordinates.");
    const actual = resample(path);
    const target = resample(data.medians[index]);
    const expectedLength = pathLength(target);
    const drawnLength = pathLength(path);
    const tolerance = Math.max(85, Math.min(145, expectedLength * 0.2));
    // Compare paths in their original order. Reversing or rearranging strokes fails.
    if (
      distance(actual[0], target[0]) > 165 ||
      distance(actual.at(-1), target.at(-1)) > 165
    )
      fail(`Stroke ${index + 1} has the wrong position or direction.`);
    const fit =
      actual.reduce((sum, p, i) => sum + distance(p, target[i]), 0) /
      actual.length;
    if (
      fit > tolerance ||
      drawnLength < expectedLength * 0.45 ||
      drawnLength > expectedLength * 2.4
    )
      fail(`Stroke ${index + 1} does not match the required stroke.`);
    return actual.map((p) => p.map(Math.round));
  });
  return {
    strokes: normalized,
    fingerprint: createHash("sha256")
      .update(char + JSON.stringify(normalized))
      .digest("hex"),
    strokeCount: data.strokes.length,
  };
}
function canSubmit(counts, characters, repetitions) {
  return (
    Array.isArray(counts) &&
    counts.length === characters.length &&
    counts.every((n) => Number.isInteger(n) && n >= repetitions)
  );
}
module.exports = {
  ValidationError,
  OWNERS,
  email,
  googleIdentity,
  charData,
  normalizeAssignment,
  validateAttempt,
  canSubmit,
  resample,
};
