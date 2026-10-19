"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue,
  Timestamp,
} = require("firebase-admin/firestore");
const { randomInt } = require("node:crypto");
const activity = require("./activities/stroke-order.cjs");
initializeApp();
setGlobalOptions({
  region: "asia-east1",
  maxInstances: 3,
  memory: "256MiB",
  timeoutSeconds: 30,
});
const db = getFirestore();
const stamp = () => FieldValue.serverTimestamp();
const error = (code, message) => {
  throw new HttpsError(code, message);
};
const id = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    error("invalid-argument", "Invalid record ID.");
  return value;
};
const memberId = (assignmentId, uid) => `${assignmentId}_${uid}`;
async function roleFor(user) {
  if (activity.OWNERS.includes(user.email)) return "owner";
  return (await db.doc(`teachers/${user.email}`).get()).exists
    ? "teacher"
    : "student";
}
async function teacher(user) {
  if ((await roleFor(user)) === "student")
    error("permission-denied", "Teacher access is required.");
}
function openAssignment(assignment) {
  if (assignment.status !== "open")
    error("failed-precondition", "This assignment is closed.");
  if (assignment.dueAt && assignment.dueAt.toMillis() < Date.now())
    error("failed-precondition", "The assignment due date has passed.");
}
const callable = (handler) =>
  onCall(async (request) => {
    try {
      const user = activity.googleIdentity(request.auth);
      return await handler(user, request.data || {});
    } catch (e) {
      if (e instanceof activity.ValidationError)
        throw new HttpsError(e.code, e.message);
      if (e instanceof HttpsError) throw e;
      console.error("Teaching tools operation failed", e);
      throw new HttpsError(
        "internal",
        "The operation could not be completed. Please try again.",
      );
    }
  });
exports.bootstrapSession = callable(async (user) => {
  const role = await roleFor(user);
  await db
    .doc(`users/${user.uid}`)
    .set(
      {
        email: user.email,
        displayName: user.name,
        photoURL: user.photoURL,
        lastLoginAt: stamp(),
      },
      { merge: true },
    );
  if (role === "owner")
    await db
      .doc(`teachers/${user.email}`)
      .set(
        { email: user.email, role: "owner", displayName: user.name },
        { merge: true },
      );
  return { ...user, role };
});
exports.setTeacherAccess = callable(async (user, input) => {
  if (!activity.OWNERS.includes(user.email))
    error(
      "permission-denied",
      "Only the initial owners can manage teacher access.",
    );
  const email = activity.email(input.email);
  if (activity.OWNERS.includes(email))
    error(
      "failed-precondition",
      "Initial owner access cannot be removed here.",
    );
  if (typeof input.enabled !== "boolean")
    error("invalid-argument", "Choose add or remove teacher.");
  if (input.enabled)
    await db
      .doc(`teachers/${email}`)
      .set({
        email,
        role: "teacher",
        grantedBy: user.email,
        grantedAt: stamp(),
      });
  else await db.doc(`teachers/${email}`).delete();
  return { email, enabled: input.enabled };
});
exports.createAssignment = callable(async (user, input) => {
  await teacher(user);
  const normalized = activity.normalizeAssignment(input);
  const ref = db.collection("assignments").doc();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tryNum = 0; tryNum < 8; tryNum++) {
    const code = Array.from(
      { length: 7 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    const result = await db.runTransaction(async (tx) => {
      const codeRef = db.doc(`assignmentCodes/${code}`);
      if ((await tx.get(codeRef)).exists) return false;
      const assignment = {
        ...normalized,
        dueAt: normalized.dueAt ? Timestamp.fromMillis(normalized.dueAt) : null,
        code,
        status: "open",
        createdBy: user.uid,
        teacherEmail: user.email,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      tx.create(ref, assignment);
      tx.create(codeRef, { assignmentId: ref.id });
      return true;
    });
    if (result) return { assignmentId: ref.id, code };
  }
  error(
    "resource-exhausted",
    "Could not create a unique assignment code. Please try again.",
  );
});
exports.setAssignmentStatus = callable(async (user, input) => {
  await teacher(user);
  if (!["open", "closed"].includes(input.status))
    error("invalid-argument", "Invalid assignment status.");
  const ref = db.doc(`assignments/${id(input.assignmentId)}`);
  if (!(await ref.get()).exists) error("not-found", "Assignment not found.");
  await ref.update({ status: input.status, updatedAt: stamp() });
  return { status: input.status };
});
exports.joinAssignment = callable(async (user, input) => {
  const code = String(input.code || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(code))
    error("invalid-argument", "Enter the seven-character assignment code.");
  const codeDoc = await db.doc(`assignmentCodes/${code}`).get();
  if (!codeDoc.exists) error("not-found", "Assignment code not found.");
  const assignmentId = codeDoc.data().assignmentId;
  const assignmentRef = db.doc(`assignments/${assignmentId}`);
  const enrollmentRef = db.doc(
    `enrollments/${memberId(assignmentId, user.uid)}`,
  );
  return db.runTransaction(async (tx) => {
    const [assignmentDoc, enrollmentDoc] = await tx.getAll(
      assignmentRef,
      enrollmentRef,
    );
    const assignment = assignmentDoc.data();
    if (!assignment) error("not-found", "Assignment not found.");
    openAssignment(assignment);
    if (
      assignment.studentEmails.length &&
      !assignment.studentEmails.includes(user.email)
    )
      error(
        "permission-denied",
        "This assignment is assigned to different student email addresses. Ask your teacher to add your Google email.",
      );
    if (!enrollmentDoc.exists)
      tx.create(enrollmentRef, {
        assignmentId,
        userId: user.uid,
        studentEmail: user.email,
        studentName: user.name,
        title: assignment.title,
        className: assignment.className,
        activityType: assignment.activityType,
        characters: assignment.characters,
        repetitions: assignment.repetitions,
        counts: assignment.characters.map(() => 0),
        status: "in-progress",
        totalMistakes: 0,
        totalElapsedMs: 0,
        joinedAt: stamp(),
        updatedAt: stamp(),
        submittedAt: null,
        activeAttemptId: null,
      });
    return { assignmentId, enrollmentId: enrollmentRef.id };
  });
});
exports.beginAttempt = callable(async (user, input) => {
  const assignmentId = id(input.assignmentId);
  const index = input.characterIndex;
  const enrollmentRef = db.doc(
    `enrollments/${memberId(assignmentId, user.uid)}`,
  );
  const assignmentRef = db.doc(`assignments/${assignmentId}`);
  const attemptRef = db.collection("attempts").doc();
  return db.runTransaction(async (tx) => {
    const [aDoc, eDoc] = await tx.getAll(assignmentRef, enrollmentRef);
    const a = aDoc.data(),
      e = eDoc.data();
    if (!a || !e) error("permission-denied", "Join this assignment first.");
    openAssignment(a);
    if (e.status === "submitted")
      error(
        "failed-precondition",
        "This assignment has already been submitted.",
      );
    if (!Number.isInteger(index) || index < 0 || index >= a.characters.length)
      error("invalid-argument", "Choose a character in this assignment.");
    if (e.counts[index] >= a.repetitions)
      error(
        "failed-precondition",
        "This character has already met its practice target.",
      );
    let previous = null;
    if (e.activeAttemptId)
      previous = await tx.get(db.doc(`attempts/${e.activeAttemptId}`));
    if (
      previous?.exists &&
      previous.data().status === "started" &&
      previous.data().characterIndex === index &&
      Date.now() - previous.data().startedAt.toMillis() < 30 * 60 * 1000
    )
      return {
        attemptId: previous.id,
        startedAt: previous.data().startedAt.toMillis(),
      };
    if (previous?.exists && previous.data().status === "started")
      tx.update(previous.ref, { status: "abandoned", endedAt: stamp() });
    tx.create(attemptRef, {
      assignmentId,
      userId: user.uid,
      characterIndex: index,
      character: a.characters[index],
      status: "started",
      startedAt: stamp(),
    });
    tx.update(enrollmentRef, {
      activeAttemptId: attemptRef.id,
      updatedAt: stamp(),
    });
    return { attemptId: attemptRef.id, startedAt: Date.now() };
  });
});
exports.completeAttempt = callable(async (user, input) => {
  const attemptRef = db.doc(`attempts/${id(input.attemptId)}`);
  const first = await attemptRef.get();
  if (!first.exists || first.data().userId !== user.uid)
    error("permission-denied", "Practice attempt not found.");
  const attempt = first.data();
  const checked = activity.validateAttempt(attempt.character, input.paths);
  const mistakes = input.mistakes;
  if (!Number.isInteger(mistakes) || mistakes < 0 || mistakes > 10000)
    error("invalid-argument", "Invalid mistake count.");
  const assignmentRef = db.doc(`assignments/${attempt.assignmentId}`);
  const enrollmentRef = db.doc(
    `enrollments/${memberId(attempt.assignmentId, user.uid)}`,
  );
  const fingerprintRef = enrollmentRef
    .collection("fingerprints")
    .doc(checked.fingerprint);
  return db.runTransaction(async (tx) => {
    const [aDoc, eDoc, attemptDoc, fingerprintDoc] = await tx.getAll(
      assignmentRef,
      enrollmentRef,
      attemptRef,
      fingerprintRef,
    );
    const a = aDoc.data(),
      e = eDoc.data(),
      t = attemptDoc.data();
    if (!a || !e || !t) error("not-found", "Practice record not found.");
    if (t.status === "completed")
      return { counts: e.counts, alreadyRecorded: true };
    openAssignment(a);
    if (
      e.status === "submitted" ||
      t.status !== "started" ||
      e.activeAttemptId !== attemptRef.id
    )
      error(
        "failed-precondition",
        "This attempt is no longer active. Start again.",
      );
    const elapsedMs = Date.now() - t.startedAt.toMillis();
    if (elapsedMs < Math.max(500, checked.strokeCount * 120))
      error(
        "failed-precondition",
        "This attempt was too short to record. Try writing the character again at a normal pace.",
      );
    if (elapsedMs > 30 * 60 * 1000)
      error(
        "deadline-exceeded",
        "This practice attempt expired. Start a new attempt.",
      );
    if (fingerprintDoc.exists)
      error(
        "already-exists",
        "This exact writing path has already been counted. Write a fresh repetition.",
      );
    const counts = [...e.counts];
    if (counts[t.characterIndex] >= a.repetitions)
      error("failed-precondition", "The practice target is already complete.");
    counts[t.characterIndex]++;
    tx.create(fingerprintRef, { attemptId: attemptRef.id, createdAt: stamp() });
    tx.update(attemptRef, {
      status: "completed",
      endedAt: stamp(),
      elapsedMs,
      mistakes,
      strokes: checked.strokes.map((points) => ({
        points: points.map(([x, y]) => ({ x, y })),
      })),
      fingerprint: checked.fingerprint,
    });
    tx.update(enrollmentRef, {
      counts,
      totalMistakes: e.totalMistakes + mistakes,
      totalElapsedMs: e.totalElapsedMs + elapsedMs,
      activeAttemptId: null,
      updatedAt: stamp(),
    });
    return { counts, alreadyRecorded: false };
  });
});
exports.submitAssignment = callable(async (user, input) => {
  const assignmentId = id(input.assignmentId);
  const enrollmentRef = db.doc(
    `enrollments/${memberId(assignmentId, user.uid)}`,
  );
  const assignmentRef = db.doc(`assignments/${assignmentId}`);
  const submissionRef = db.doc(
    `submissions/${memberId(assignmentId, user.uid)}`,
  );
  return db.runTransaction(async (tx) => {
    const [aDoc, eDoc, sDoc] = await tx.getAll(
      assignmentRef,
      enrollmentRef,
      submissionRef,
    );
    const a = aDoc.data(),
      e = eDoc.data();
    if (!a || !e) error("permission-denied", "Join this assignment first.");
    if (sDoc.exists) return { submissionId: sDoc.id, alreadySubmitted: true };
    openAssignment(a);
    if (!activity.canSubmit(e.counts, a.characters, a.repetitions))
      error(
        "failed-precondition",
        "Finish every required repetition before submitting.",
      );
    tx.create(submissionRef, {
      assignmentId,
      userId: user.uid,
      studentEmail: user.email,
      studentName: user.name,
      title: a.title,
      characters: a.characters,
      repetitions: a.repetitions,
      counts: e.counts,
      totalMistakes: e.totalMistakes,
      totalElapsedMs: e.totalElapsedMs,
      submittedAt: stamp(),
      status: "submitted",
    });
    tx.update(enrollmentRef, {
      status: "submitted",
      submittedAt: stamp(),
      activeAttemptId: null,
      updatedAt: stamp(),
    });
    return { submissionId: submissionRef.id, alreadySubmitted: false };
  });
});
