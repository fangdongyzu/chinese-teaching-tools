const { test, before } = require("node:test");
const assert = require("node:assert/strict");
process.env.GCLOUD_PROJECT = "demo-teaching-tools";
process.env.GOOGLE_CLOUD_PROJECT = "demo-teaching-tools";
const service = require("../functions/index.cjs");
const { getFirestore, Timestamp } = require("node:module").createRequire(
  require.resolve("../functions/index.cjs"),
)("firebase-admin/firestore");
const { charData } = require("../functions/activities/stroke-order.cjs");
const db = getFirestore();
const request = (uid, email, data = {}) => ({
  auth: {
    uid,
    token: {
      email,
      email_verified: true,
      name: uid,
      firebase: { sign_in_provider: "google.com" },
    },
  },
  data,
});
const owner = (data) => request("owner", "tristanlpd@gm.lhu.edu.tw", data),
  student = (data) => request("alice", "alice@example.com", data),
  other = (data) => request("bob", "bob@example.com", data);
async function ageAttempt(attemptId) {
  await db
    .doc(`attempts/${attemptId}`)
    .update({ startedAt: Timestamp.fromMillis(Date.now() - 3000) });
}
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Run this test through the Firebase emulator.");
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-teaching-tools/databases/(default)/documents`,
    { method: "DELETE" },
  );
});
test("teacher assignment, Google student practice, reviewable evidence and submission", async () => {
  assert.equal((await service.bootstrapSession.run(owner())).role, "owner");
  assert.equal((await service.bootstrapSession.run(student())).role, "student");
  await assert.rejects(
    service.setTeacherAccess.run(
      student({ email: "alice@example.com", enabled: true }),
    ),
    /owners/,
  );
  await service.setTeacherAccess.run(
    owner({ email: "teacher@example.com", enabled: true }),
  );
  assert.equal(
    (await service.bootstrapSession.run(request("t", "teacher@example.com")))
      .role,
    "teacher",
  );
  await service.setTeacherAccess.run(
    owner({ email: "teacher@example.com", enabled: false }),
  );
  assert.equal(
    (await service.bootstrapSession.run(request("t", "teacher@example.com")))
      .role,
    "student",
  );
  await assert.rejects(
    service.setTeacherAccess.run(
      owner({ email: "tristanlpd@gmail.com", enabled: false }),
    ),
    /owner/,
  );
  const { assignmentId, code } = await service.createAssignment.run(
    owner({
      activityType: "stroke-order",
      title: "Practice 一 twice",
      text: "一一",
      repetitions: 2,
      mode: "write",
      dueAt: null,
      studentEmails: ["alice@example.com"],
    }),
  );
  await assert.rejects(
    service.joinAssignment.run(other({ code })),
    /different student/,
  );
  await service.joinAssignment.run(student({ code }));
  await assert.rejects(
    service.submitAssignment.run(student({ assignmentId })),
    /Finish every/,
  );
  let first = await service.beginAttempt.run(
    student({ assignmentId, characterIndex: 0 }),
  );
  await ageAttempt(first.attemptId);
  await assert.rejects(
    service.completeAttempt.run(
      other({
        attemptId: first.attemptId,
        paths: charData("一").medians,
        mistakes: 0,
      }),
    ),
    /not found/,
  );
  await assert.rejects(
    service.completeAttempt.run(
      student({
        attemptId: first.attemptId,
        paths: [charData("一").medians[0].slice().reverse()],
        mistakes: 0,
      }),
    ),
    /direction|match/,
  );
  const payload = {
    attemptId: first.attemptId,
    paths: charData("一").medians,
    mistakes: 2,
  };
  const outcomes = await Promise.all([
    service.completeAttempt.run(student(payload)),
    service.completeAttempt.run(student(payload)),
  ]);
  assert.deepEqual(
    outcomes.map((o) => o.counts),
    [[1], [1]],
  );
  await assert.rejects(
    service.submitAssignment.run(student({ assignmentId })),
    /Finish every/,
  );
  const second = await service.beginAttempt.run(
    student({ assignmentId, characterIndex: 0 }),
  );
  await ageAttempt(second.attemptId);
  await assert.rejects(
    service.completeAttempt.run(
      student({ ...payload, attemptId: second.attemptId }),
    ),
    /already been counted/,
  );
  const fresh = charData("一").medians.map((p) =>
    p.map(([x, y]) => [x + 3, y + 2]),
  );
  await service.completeAttempt.run(
    student({ attemptId: second.attemptId, paths: fresh, mistakes: 1 }),
  );
  const submit = await service.submitAssignment.run(student({ assignmentId }));
  assert.equal(submit.alreadySubmitted, false);
  assert.equal(
    (await service.submitAssignment.run(student({ assignmentId })))
      .alreadySubmitted,
    true,
  );
  const enrollment = (
    await db.doc(`enrollments/${assignmentId}_alice`).get()
  ).data();
  assert.deepEqual(enrollment.counts, [2]);
  assert.equal(enrollment.status, "submitted");
  assert.equal(enrollment.totalMistakes, 3);
  const attempts = await db
    .collection("attempts")
    .where("assignmentId", "==", assignmentId)
    .get();
  assert.equal(
    attempts.docs.filter((d) => d.data().status === "completed").length,
    2,
  );
  assert.equal(attempts.docs[0].data().strokes[0].points.length, 24);
  await assert.rejects(
    service.beginAttempt.run(student({ assignmentId, characterIndex: 0 })),
    /already been submitted/,
  );
});
test("closing an assignment prevents joining and practice", async () => {
  const a = await service.createAssignment.run(
    owner({
      activityType: "stroke-order",
      title: "Closed work",
      text: "人",
      repetitions: 1,
      mode: "trace",
      dueAt: null,
      studentEmails: [],
    }),
  );
  await service.joinAssignment.run(student({ code: a.code }));
  await service.setAssignmentStatus.run(
    owner({ assignmentId: a.assignmentId, status: "closed" }),
  );
  await assert.rejects(
    service.beginAttempt.run(
      student({ assignmentId: a.assignmentId, characterIndex: 0 }),
    ),
    /closed/,
  );
  await assert.rejects(
    service.joinAssignment.run(other({ code: a.code })),
    /closed/,
  );
});
