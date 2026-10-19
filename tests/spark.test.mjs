import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { createClassroomStore } from "../src/classroom-store.js";
let env, owner, alice, bob, assignmentId, code, aliceDb;
const token = (email) => ({
  email,
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
});
const loadData = async (char) =>
  JSON.parse(
    fs.readFileSync(new URL(`./fixtures/${char}.json`, import.meta.url)),
  );
function client(uid, email) {
  const db = env.authenticatedContext(uid, token(email)).firestore();
  const user = {
    uid,
    email,
    emailVerified: true,
    displayName: uid,
    photoURL: "",
    providerData: [{ providerId: "google.com" }],
  };
  return {
    db,
    store: createClassroomStore({ db, getUser: () => user, loadData }),
  };
}
const details = {
  activityType: "stroke-order",
  title: "Practice 一 twice",
  text: "一一",
  repetitions: 2,
  mode: "write",
  dueAt: null,
  studentEmails: ["alice@example.com"],
};
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-teaching-tools",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.clearFirestore();
  owner = client("owner", "tristanlpd@gm.lhu.edu.tw");
  const a = client("alice", "alice@example.com");
  alice = a.store;
  aliceDb = a.db;
  bob = client("bob", "bob@example.com");
});
after(async () => env?.cleanup());
test("Google login and both initial owners work without functions", async () => {
  assert.equal((await owner.store.call("bootstrapSession")).role, "owner");
  assert.equal(
    (
      await client("owner2", "tristanlpd@gmail.com").store.call(
        "bootstrapSession",
      )
    ).role,
    "owner",
  );
  assert.equal((await alice.call("bootstrapSession")).role, "student");
});
test("only owners can grant and remove teacher access", async () => {
  await assert.rejects(
    alice.call("setTeacherAccess", {
      email: "alice@example.com",
      enabled: true,
    }),
    /owners/,
  );
  await assertFails(
    setDoc(doc(aliceDb, "teachers/alice@example.com"), {
      email: "alice@example.com",
      role: "teacher",
      grantedBy: "alice@example.com",
      grantedAt: serverTimestamp(),
    }),
  );
  await owner.store.call("setTeacherAccess", {
    email: "teacher@example.com",
    enabled: true,
  });
  const teacher = client("teacher", "teacher@example.com");
  assert.equal((await teacher.store.call("bootstrapSession")).role, "teacher");
  await assert.rejects(
    teacher.store.call("setTeacherAccess", {
      email: "other@example.com",
      enabled: true,
    }),
    /owners/,
  );
  await owner.store.call("setTeacherAccess", {
    email: "teacher@example.com",
    enabled: false,
  });
  assert.equal((await teacher.store.call("bootstrapSession")).role, "student");
  await assert.rejects(
    owner.store.call("setTeacherAccess", {
      email: "tristanlpd@gmail.com",
      enabled: false,
    }),
    /owner/,
  );
});
test("teachers create assignments and private rosters stay private", async () => {
  ({ assignmentId, code } = await owner.store.call(
    "createAssignment",
    details,
  ));
  await assertFails(getDoc(doc(aliceDb, "assignments", assignmentId)));
  const publicCode = await getDoc(doc(aliceDb, "assignmentCodes", code));
  assert.equal(publicCode.data().studentEmails, undefined);
  await assert.rejects(bob.store.call("joinAssignment", { code }));
  await alice.call("joinAssignment", { code });
});
test("anonymous, unverified and non-Google accounts cannot read assignments", async () => {
  for (const db of [
    env.unauthenticatedContext().firestore(),
    env
      .authenticatedContext("alice", {
        ...token("alice@example.com"),
        email_verified: false,
      })
      .firestore(),
    env
      .authenticatedContext("alice", {
        ...token("alice@example.com"),
        firebase: { sign_in_provider: "password" },
      })
      .firestore(),
  ])
    await assertFails(getDoc(doc(db, "assignmentCodes", code)));
});
test("students cannot directly change counts, role, title or identity", async () => {
  const ref = doc(aliceDb, "enrollments", `${assignmentId}_alice`);
  for (const change of [
    { counts: { 一: 2 } },
    { studentEmail: "other@example.com" },
    { title: "Changed" },
  ])
    await assertFails(
      updateDoc(ref, { ...change, updatedAt: serverTimestamp() }),
    );
  await assertFails(
    setDoc(doc(aliceDb, "users/alice"), {
      email: "alice@example.com",
      displayName: "alice",
      photoURL: "",
      lastLoginAt: serverTimestamp(),
      role: "teacher",
    }),
  );
  await assert.rejects(
    alice.call("submitAssignment", { assignmentId }),
    /Finish every/,
  );
});
test("normal practice saves evidence and concurrent retries count only once", async () => {
  const start = await alice.call("beginAttempt", {
    assignmentId,
    characterIndex: 0,
  });
  const payload = {
    attemptId: start.attemptId,
    paths: (await loadData("一")).medians,
    mistakes: 2,
  };
  await assert.rejects(
    alice.call("completeAttempt", {
      ...payload,
      paths: [payload.paths[0].slice().reverse()],
    }),
  );
  await assert.rejects(bob.store.call("completeAttempt", payload));
  const result = await Promise.all([
    alice.call("completeAttempt", payload),
    alice.call("completeAttempt", payload),
  ]);
  assert.deepEqual(
    result.map((r) => r.counts),
    [[1], [1]],
  );
  const recorded = await getDoc(doc(aliceDb, "attempts", start.attemptId));
  assert.equal(recorded.data().validationSource, "browser");
  assert.equal(recorded.data().strokes[0].points.length, 24);
  await assertFails(getDoc(doc(bob.db, "attempts", start.attemptId)));
});
test("count jumps and naked attempt completion are blocked by rules", async () => {
  const start = await alice.call("beginAttempt", {
    assignmentId,
    characterIndex: 0,
  });
  await assertFails(
    updateDoc(doc(aliceDb, "attempts", start.attemptId), {
      status: "completed",
      endedAt: serverTimestamp(),
      elapsedMs: 1000,
      mistakes: 0,
      strokes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
      fingerprint: "a".repeat(64),
    }),
  );
  await assertFails(
    updateDoc(doc(aliceDb, "enrollments", `${assignmentId}_alice`), {
      counts: { 一: 50 },
      updatedAt: serverTimestamp(),
    }),
  );
});
test("fresh repetitions reach quota and immutable submission is explicit", async () => {
  const start = await alice.call("beginAttempt", {
    assignmentId,
    characterIndex: 0,
  });
  const d = await loadData("一");
  await assert.rejects(
    alice.call("completeAttempt", {
      attemptId: start.attemptId,
      paths: d.medians,
      mistakes: 0,
    }),
    /already been counted/,
  );
  const paths = d.medians.map((p) => p.map(([x, y]) => [x + 3, y + 2]));
  await alice.call("completeAttempt", {
    attemptId: start.attemptId,
    paths,
    mistakes: 1,
  });
  const result = await alice.call("submitAssignment", { assignmentId });
  assert.equal(result.alreadySubmitted, false);
  assert.equal(
    (await alice.call("submitAssignment", { assignmentId })).alreadySubmitted,
    true,
  );
  const ref = doc(aliceDb, "enrollments", `${assignmentId}_alice`);
  assert.equal((await getDoc(ref)).data().status, "submitted");
  await assertFails(
    updateDoc(ref, { counts: { 一: 0 }, updatedAt: serverTimestamp() }),
  );
  await assertFails(
    updateDoc(doc(aliceDb, "submissions", `${assignmentId}_alice`), {
      totalMistakes: 0,
    }),
  );
  await assert.rejects(
    alice.call("beginAttempt", { assignmentId, characterIndex: 0 }),
    /submitted/,
  );
});
test("teachers can review results but students cannot enumerate other students", async () => {
  await assertSucceeds(
    getDoc(doc(owner.db, "enrollments", `${assignmentId}_alice`)),
  );
  await assertSucceeds(
    getDocs(
      query(collection(aliceDb, "enrollments"), where("userId", "==", "alice")),
    ),
  );
  await assertFails(getDocs(collection(aliceDb, "enrollments")));
  await assertFails(getDocs(collection(aliceDb, "assignmentCodes")));
});
test("closed assignments reject new work", async () => {
  const a = await owner.store.call("createAssignment", {
    ...details,
    title: "Closed assignment",
    studentEmails: [],
  });
  await alice.call("joinAssignment", { code: a.code });
  await owner.store.call("setAssignmentStatus", {
    assignmentId: a.assignmentId,
    status: "closed",
  });
  await assert.rejects(
    alice.call("beginAttempt", {
      assignmentId: a.assignmentId,
      characterIndex: 0,
    }),
    /closed/,
  );
  await assert.rejects(
    bob.store.call("joinAssignment", { code: a.code }),
    /closed/,
  );
});

test("Redo abandons the unfinished attempt, preserves counts, and records fresh writing", async () => {
  const a = await owner.store.call("createAssignment", {
    ...details,
    title: "Redo practice",
  });
  await alice.call("joinAssignment", { code: a.code });
  const input = { assignmentId: a.assignmentId, characterIndex: 0 };
  const first = await alice.call("beginAttempt", input);
  const redo = await alice.call("beginAttempt", { ...input, restart: true });
  assert.notEqual(first.attemptId, redo.attemptId);
  assert.equal(
    (await getDoc(doc(aliceDb, "attempts", first.attemptId))).data().status,
    "abandoned",
  );
  const paths = (await loadData("一")).medians.map((p) =>
    p.map(([x, y]) => [x + 170, y]),
  );
  await assert.rejects(
    alice.call("completeAttempt", {
      attemptId: first.attemptId,
      paths,
      mistakes: 0,
    }),
    /no longer active/,
  );
  assert.deepEqual(
    (
      await alice.call("completeAttempt", {
        attemptId: redo.attemptId,
        paths,
        mistakes: 0,
      })
    ).counts,
    [1],
  );
  const next = await alice.call("beginAttempt", { ...input, restart: true });
  const member = await getDoc(
    doc(aliceDb, "enrollments", `${a.assignmentId}_alice`),
  );
  assert.equal(member.data().counts.一, 1);
  assert.equal(member.data().activeAttemptId, next.attemptId);
  assert.deepEqual(
    (
      await alice.call("completeAttempt", {
        attemptId: next.attemptId,
        paths: paths.map((p) => p.map(([x, y]) => [x + 3, y])),
        mistakes: 0,
      })
    ).counts,
    [2],
  );
});

test("an atomic batch cannot count more than one repetition for one attempt", async () => {
  const a = await owner.store.call("createAssignment", {
    ...details,
    title: "No count jumps",
    repetitions: 3,
  });
  await alice.call("joinAssignment", { code: a.code });
  const started = await alice.call("beginAttempt", {
    assignmentId: a.assignmentId,
    characterIndex: 0,
  });
  const member = doc(aliceDb, "enrollments", `${a.assignmentId}_alice`);
  const hash = "d".repeat(64);
  const batch = writeBatch(aliceDb);
  batch.set(doc(member, "fingerprints", hash), {
    attemptId: started.attemptId,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(aliceDb, "attempts", started.attemptId), {
    status: "completed",
    endedAt: serverTimestamp(),
    elapsedMs: 1000,
    mistakes: 0,
    strokes: [
      {
        points: [
          { x: 121, y: 393 },
          { x: 920, y: 401 },
        ],
      },
    ],
    fingerprint: hash,
  });
  batch.update(member, {
    counts: { 一: 2 },
    totalMistakes: 0,
    totalElapsedMs: 1000,
    activeAttemptId: null,
    lastCountedAttemptId: started.attemptId,
    updatedAt: serverTimestamp(),
  });
  await assertFails(batch.commit());
  assert.equal((await getDoc(member)).data().counts.一, 0);
});

test("the Firestore rules enforce a deadline even when a client bypasses the helper", async () => {
  const a = await owner.store.call("createAssignment", {
    ...details,
    title: "Deadline test",
    studentEmails: [],
    repetitions: 1,
    dueAt: Date.now() + 1500,
  });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await assertFails(
    setDoc(doc(bob.db, "enrollments", `${a.assignmentId}_bob`), {
      assignmentId: a.assignmentId,
      code: a.code,
      userId: "bob",
      studentEmail: "bob@example.com",
      studentName: "bob",
      title: "Deadline test",
      className: "",
      activityType: "stroke-order",
      characters: ["一"],
      repetitions: 1,
      counts: { 一: 0 },
      status: "in-progress",
      totalMistakes: 0,
      totalElapsedMs: 0,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      submittedAt: null,
      activeAttemptId: null,
      lastCountedAttemptId: null,
    }),
  );
});
