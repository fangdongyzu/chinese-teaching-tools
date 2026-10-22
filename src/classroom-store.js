import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  OWNERS,
  email,
  normalizeAssignment,
  validateAttempt,
  canSubmit,
  fingerprint,
} from "./domain.js";
import { loadCharacterData as defaultLoader } from "./character-data.js";
export const countsArray = (record) =>
  Array.isArray(record.counts)
    ? record.counts
    : record.characters.map((char) => record.counts[char] || 0);
export const enrollmentRecord = (snapshot) => {
  const data = snapshot.data();
  return { id: snapshot.id, ...data, counts: countsArray(data) };
};
const fail = (message) => {
  throw new Error(message);
};
const recordId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    fail("Invalid record ID.");
  return value;
};
const time = (value) => value?.toMillis?.() || 0;
function checkOpen(a) {
  if (a.status !== "open") fail("This assignment is closed.");
  if (a.dueAt && time(a.dueAt) < Date.now())
    fail("The assignment due date has passed.");
}
function publicAssignment(a, assignmentId) {
  return {
    assignmentId,
    title: a.title,
    text: a.text,
    className: a.className,
    characters: a.characters,
    repetitions: a.repetitions,
    mode: a.mode,
    instructions: a.instructions,
    activityType: a.activityType,
    dueAt: a.dueAt,
    code: a.code,
    status: a.status,
    strokeCounts: a.strokeCounts,
  };
}
export function createClassroomStore({
  db,
  getUser,
  loadData = defaultLoader,
}) {
  function identity() {
    const u = getUser();
    if (
      !u ||
      !u.emailVerified ||
      !u.providerData?.some((p) => p.providerId === "google.com")
    )
      fail("Sign in with a verified Google account.");
    return {
      uid: u.uid,
      email: email(u.email),
      name: String(u.displayName || u.email).slice(0, 120),
      photoURL: String(u.photoURL || "").slice(0, 1000),
    };
  }
  async function role(user) {
    if (OWNERS.includes(user.email)) return "owner";
    return (await getDoc(doc(db, "teachers", user.email))).exists()
      ? "teacher"
      : "student";
  }
  async function requireTeacher(user) {
    if ((await role(user)) === "student") fail("Teacher access is required.");
  }
  const membership = (assignmentId, user) =>
    doc(db, "enrollments", `${assignmentId}_${user.uid}`);
  async function assignmentFromEnrollment(enrollment) {
    const snapshot = await getDoc(doc(db, "assignmentCodes", enrollment.code));
    if (!snapshot.exists()) fail("Assignment not found.");
    return { id: enrollment.assignmentId, ...snapshot.data() };
  }
  async function bootstrapSession() {
    const user = identity();
    await setDoc(
      doc(db, "users", user.uid),
      {
        email: user.email,
        displayName: user.name,
        photoURL: user.photoURL,
        lastLoginAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { ...user, role: await role(user) };
  }
  async function setTeacherAccess(input) {
    const user = identity();
    if (!OWNERS.includes(user.email))
      fail("Only the initial owners can manage teacher access.");
    const target = email(input.email);
    if (OWNERS.includes(target))
      fail("Initial owner access cannot be changed here.");
    if (typeof input.enabled !== "boolean") fail("Choose add or remove.");
    if (input.enabled)
      await setDoc(doc(db, "teachers", target), {
        email: target,
        role: "teacher",
        grantedBy: user.email,
        grantedAt: serverTimestamp(),
      });
    else await deleteDoc(doc(db, "teachers", target));
    return { email: target, enabled: input.enabled };
  }
  async function createAssignment(input) {
    const user = identity();
    await requireTeacher(user);
    const a = normalizeAssignment(input);
    const strokeCounts = {};
    for (let i = 0; i < a.characters.length; i += 6)
      await Promise.all(
        a.characters.slice(i, i + 6).map(async (char) => {
          strokeCounts[char] = (await loadData(char)).strokes.length;
        }),
      );
    const ref = doc(collection(db, "assignments"));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 8; i++) {
      const random = crypto.getRandomValues(new Uint8Array(7));
      const code = Array.from(
        random,
        (n) => alphabet[n % alphabet.length],
      ).join("");
      const codeRef = doc(db, "assignmentCodes", code);
      const created = await runTransaction(db, async (tx) => {
        if ((await tx.get(codeRef)).exists()) return false;
        const assignment = {
          ...a,
          dueAt: a.dueAt ? Timestamp.fromMillis(a.dueAt) : null,
          code,
          status: "open",
          strokeCounts,
          createdBy: user.uid,
          teacherEmail: user.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        tx.set(ref, assignment);
        tx.set(codeRef, publicAssignment(assignment, ref.id));
        return true;
      });
      if (created) return { assignmentId: ref.id, code };
    }
    fail("Could not create an assignment code. Please try again.");
  }
  async function setAssignmentStatus(input) {
    const user = identity();
    await requireTeacher(user);
    if (!["open", "closed"].includes(input.status))
      fail("Invalid assignment status.");
    const ref = doc(db, "assignments", recordId(input.assignmentId));
    return runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) fail("Assignment not found.");
      tx.update(ref, { status: input.status, updatedAt: serverTimestamp() });
      tx.update(doc(db, "assignmentCodes", snapshot.data().code), {
        status: input.status,
      });
      return { status: input.status };
    });
  }
  async function updateStudentName(input) {
    const user = identity();
    await requireTeacher(user);
    const enrollmentId = recordId(input.enrollmentId);
    const studentName = String(input.studentName || "").trim();
    if (!studentName || studentName.length > 120)
      fail("Enter a student name up to 120 characters.");
    const ref = doc(db, "enrollments", enrollmentId);
    return runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) fail("Student assignment not found.");
      tx.update(ref, { studentName, updatedAt: serverTimestamp() });
      return { studentName };
    });
  }
  async function updateStudentGrade(input) {
    const user = identity();
    await requireTeacher(user);
    const enrollmentId = recordId(input.enrollmentId);
    const grade = input.grade === null ? null : Number(input.grade);
    if (grade !== null && (!Number.isInteger(grade) || grade < 0 || grade > 100))
      fail("Enter a whole-number grade from 0 to 100, or leave it blank.");
    const ref = doc(db, "enrollments", enrollmentId);
    return runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) fail("Student assignment not found.");
      tx.update(ref, { grade, updatedAt: serverTimestamp() });
      return { grade };
    });
  }
  async function joinAssignment(input) {
    const user = identity();
    const code = String(input.code || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(code))
      fail("Enter the seven-character assignment code.");
    return runTransaction(db, async (tx) => {
      const codeDoc = await tx.get(doc(db, "assignmentCodes", code));
      if (!codeDoc.exists()) fail("Assignment code not found.");
      const a = codeDoc.data();
      checkOpen(a);
      const ref = membership(a.assignmentId, user);
      const existing = await tx.get(ref);
      if (!existing.exists())
        tx.set(ref, {
          assignmentId: a.assignmentId,
          code,
          userId: user.uid,
          studentEmail: user.email,
          studentName: user.name,
          title: a.title,
          className: a.className,
          activityType: a.activityType,
          characters: a.characters,
          repetitions: a.repetitions,
          counts: Object.fromEntries(a.characters.map((char) => [char, 0])),
          status: "in-progress",
          totalMistakes: 0,
          totalElapsedMs: 0,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          submittedAt: null,
          activeAttemptId: null,
          lastCountedAttemptId: null,
        });
      return { assignmentId: a.assignmentId, enrollmentId: ref.id };
    });
  }
  async function beginAttempt(input) {
    const user = identity();
    const assignmentId = recordId(input.assignmentId);
    const ref = membership(assignmentId, user);
    const attemptRef = doc(collection(db, "attempts"));
    return runTransaction(db, async (tx) => {
      const eDoc = await tx.get(ref);
      if (!eDoc.exists()) fail("Join this assignment first.");
      const e = eDoc.data();
      const codeDoc = await tx.get(doc(db, "assignmentCodes", e.code));
      const a = codeDoc.data();
      checkOpen(a);
      if (e.status === "submitted")
        fail("This assignment has already been submitted.");
      const index = input.characterIndex;
      if (!Number.isInteger(index) || index < 0 || index >= a.characters.length)
        fail("Choose a character in this assignment.");
      const char = a.characters[index];
      if (e.counts[char] >= a.repetitions)
        fail("This character has met its practice target.");
      let old = null;
      if (e.activeAttemptId)
        old = await tx.get(doc(db, "attempts", e.activeAttemptId));
      if (
        old?.exists() &&
        old.data().status === "started" &&
        input.restart !== true &&
        old.data().characterIndex === index &&
        Date.now() - time(old.data().startedAt) < 1800000
      )
        return { attemptId: old.id, startedAt: time(old.data().startedAt) };
      if (old?.exists() && old.data().status === "started")
        tx.update(old.ref, { status: "abandoned", endedAt: serverTimestamp() });
      tx.set(attemptRef, {
        assignmentId,
        userId: user.uid,
        code: e.code,
        characterIndex: index,
        character: char,
        status: "started",
        startedAt: serverTimestamp(),
        endedAt: null,
        elapsedMs: 0,
        mistakes: 0,
        strokes: [],
        fingerprint: null,
        validationSource: "browser",
      });
      tx.update(ref, {
        activeAttemptId: attemptRef.id,
        updatedAt: serverTimestamp(),
      });
      return { attemptId: attemptRef.id, startedAt: Date.now() };
    });
  }
  async function completeAttempt(input) {
    const user = identity();
    const attemptRef = doc(db, "attempts", recordId(input.attemptId));
    const initial = await getDoc(attemptRef);
    if (!initial.exists() || initial.data().userId !== user.uid)
      fail("Practice attempt not found.");
    const t = initial.data();
    const checked = validateAttempt(
      t.character,
      input.paths,
      await loadData(t.character),
    );
    const digest = await fingerprint(t.character, checked.strokes);
    if (
      !Number.isInteger(input.mistakes) ||
      input.mistakes < 0 ||
      input.mistakes > 10000
    )
      fail("Invalid mistake count.");
    const ref = membership(t.assignmentId, user);
    const fingerprintRef = doc(ref, "fingerprints", digest);
    return runTransaction(db, async (tx) => {
      const attemptDoc = await tx.get(attemptRef);
      const eDoc = await tx.get(ref);
      const fingerprintDoc = await tx.get(fingerprintRef);
      const e = eDoc.data(),
        attempt = attemptDoc.data();
      const aDoc = await tx.get(doc(db, "assignmentCodes", e.code));
      const a = aDoc.data();
      if (attempt.status === "completed")
        return { counts: countsArray(e), alreadyRecorded: true };
      checkOpen(a);
      if (
        e.status === "submitted" ||
        attempt.status !== "started" ||
        e.activeAttemptId !== attemptRef.id
      )
        fail("This attempt is no longer active. Start again.");
      const elapsedMs = Date.now() - time(attempt.startedAt);
      if (elapsedMs > 1800000)
        fail("This attempt expired. Start a new repetition.");
      if (fingerprintDoc.exists())
        fail(
          "This exact writing path has already been counted. Write a fresh repetition.",
        );
      if (e.counts[attempt.character] >= a.repetitions)
        fail("The practice target is already complete.");
      const counts = {
        ...e.counts,
        [attempt.character]: e.counts[attempt.character] + 1,
      };
      tx.set(fingerprintRef, {
        attemptId: attemptRef.id,
        createdAt: serverTimestamp(),
      });
      tx.update(attemptRef, {
        status: "completed",
        endedAt: serverTimestamp(),
        elapsedMs: Math.max(0, elapsedMs),
        mistakes: input.mistakes,
        strokes: checked.strokes.map((points) => ({
          points: points.map(([x, y]) => ({ x, y })),
        })),
        fingerprint: digest,
      });
      tx.update(ref, {
        counts,
        totalMistakes: e.totalMistakes + input.mistakes,
        totalElapsedMs: e.totalElapsedMs + Math.max(0, elapsedMs),
        activeAttemptId: null,
        lastCountedAttemptId: attemptRef.id,
        updatedAt: serverTimestamp(),
      });
      return {
        counts: a.characters.map((char) => counts[char]),
        alreadyRecorded: false,
      };
    }).catch(async (error) => {
      // A competing tab can commit first; rules reject a second fingerprint write
      // before the SDK retries. Read the authoritative result instead of counting twice.
      try {
        const saved = await getDocFromServer(attemptRef);
        if (
          saved.exists() &&
          saved.data().userId === user.uid &&
          saved.data().status === "completed"
        ) {
          const member = await getDocFromServer(ref);
          return { counts: countsArray(member.data()), alreadyRecorded: true };
        }
      } catch {
        /* Preserve the original failure when the server cannot be read. */
      }
      throw error;
    });
  }
  async function submitAssignment(input) {
    const user = identity();
    const assignmentId = recordId(input.assignmentId);
    const ref = membership(assignmentId, user),
      submissionRef = doc(db, "submissions", ref.id);
    return runTransaction(db, async (tx) => {
      const eDoc = await tx.get(ref);
      const sDoc = await tx.get(submissionRef);
      if (!eDoc.exists()) fail("Join this assignment first.");
      if (sDoc.exists())
        return { submissionId: sDoc.id, alreadySubmitted: true };
      const e = eDoc.data();
      const aDoc = await tx.get(doc(db, "assignmentCodes", e.code));
      checkOpen(aDoc.data());
      if (!canSubmit(countsArray(e), e.characters, e.repetitions))
        fail("Finish every required repetition before submitting.");
      tx.set(submissionRef, {
        assignmentId,
        userId: user.uid,
        studentEmail: user.email,
        studentName: e.studentName,
        title: e.title,
        characters: e.characters,
        repetitions: e.repetitions,
        counts: e.counts,
        totalMistakes: e.totalMistakes,
        totalElapsedMs: e.totalElapsedMs,
        submittedAt: serverTimestamp(),
        status: "submitted",
        validationSource: "browser",
      });
      tx.update(ref, {
        status: "submitted",
        submittedAt: serverTimestamp(),
        activeAttemptId: null,
        updatedAt: serverTimestamp(),
      });
      return { submissionId: submissionRef.id, alreadySubmitted: false };
    });
  }
  const methods = {
    bootstrapSession,
    setTeacherAccess,
    createAssignment,
    setAssignmentStatus,
    updateStudentName,
    updateStudentGrade,
    joinAssignment,
    beginAttempt,
    completeAttempt,
    submitAssignment,
  };
  return {
    assignmentFromEnrollment,
    async call(name, input = {}) {
      if (!Object.hasOwn(methods, name)) fail("Unknown classroom action.");
      return methods[name](input);
    },
  };
}

