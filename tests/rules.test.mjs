import { test, before, after } from "node:test";
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
  collection,
  query,
  where,
} from "firebase/firestore";
let env;
const token = (email) => ({
  email,
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
});
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-teaching-tools",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "teachers/teacher@example.com"), {
      email: "teacher@example.com",
    });
    await setDoc(doc(db, "assignments/a1"), { title: "Test" });
    await setDoc(doc(db, "assignments/a2"), { title: "Private" });
    await setDoc(doc(db, "enrollments/a1_alice"), {
      userId: "alice",
      assignmentId: "a1",
      counts: [0],
    });
    await setDoc(doc(db, "enrollments/a1_bob"), {
      userId: "bob",
      assignmentId: "a1",
      counts: [1],
    });
    await setDoc(doc(db, "attempts/attempt1"), { userId: "alice" });
    await setDoc(doc(db, "submissions/a1_alice"), { userId: "alice" });
  });
});
after(async () => env?.cleanup());
test("anonymous visitors cannot read assignments", async () =>
  assertFails(
    getDoc(doc(env.unauthenticatedContext().firestore(), "assignments/a1")),
  ));
test("students can read their assigned work and their own results", async () => {
  const db = env
    .authenticatedContext("alice", token("alice@example.com"))
    .firestore();
  await assertSucceeds(getDoc(doc(db, "assignments/a1")));
  await assertSucceeds(getDoc(doc(db, "enrollments/a1_alice")));
  await assertSucceeds(getDoc(doc(db, "attempts/attempt1")));
  await assertSucceeds(getDoc(doc(db, "submissions/a1_alice")));
});
test("students cannot read unrelated assignments or another student results", async () => {
  const db = env
    .authenticatedContext("alice", token("alice@example.com"))
    .firestore();
  await assertFails(getDoc(doc(db, "assignments/a2")));
  await assertFails(getDoc(doc(db, "enrollments/a1_bob")));
});
test("student enrollment queries must be scoped to the signed-in user", async () => {
  const db = env
    .authenticatedContext("alice", token("alice@example.com"))
    .firestore();
  await assertSucceeds(
    getDocs(
      query(collection(db, "enrollments"), where("userId", "==", "alice")),
    ),
  );
  await assertFails(getDocs(collection(db, "enrollments")));
});
test("students cannot self-promote, change counts, or create submissions", async () => {
  const db = env
    .authenticatedContext("alice", token("alice@example.com"))
    .firestore();
  for (const path of [
    "teachers/alice@example.com",
    "enrollments/a1_alice",
    "attempts/fake",
    "submissions/fake",
    "assignments/fake",
  ])
    await assertFails(
      setDoc(doc(db, path), { userId: "alice", counts: [100] }),
    );
});
test("teachers can read results but cannot bypass the server write path", async () => {
  const db = env
    .authenticatedContext("teacher", token("teacher@example.com"))
    .firestore();
  await assertSucceeds(getDoc(doc(db, "enrollments/a1_bob")));
  await assertSucceeds(getDocs(collection(db, "assignments")));
  await assertFails(
    setDoc(doc(db, "enrollments/a1_bob"), { userId: "bob", counts: [100] }),
  );
});
test("both initial owners can read teacher access records", async () => {
  for (const email of ["tristanlpd@gm.lhu.edu.tw", "tristanlpd@gmail.com"])
    await assertSucceeds(
      getDocs(
        collection(
          env
            .authenticatedContext(email.split("@")[0], token(email))
            .firestore(),
          "teachers",
        ),
      ),
    );
});
test("unverified and non-Google accounts cannot access the app database", async () => {
  const unverified = env
    .authenticatedContext("alice", {
      ...token("alice@example.com"),
      email_verified: false,
    })
    .firestore();
  const password = env
    .authenticatedContext("alice", {
      ...token("alice@example.com"),
      firebase: { sign_in_provider: "password" },
    })
    .firestore();
  await assertFails(getDoc(doc(unverified, "enrollments/a1_alice")));
  await assertFails(getDoc(doc(password, "enrollments/a1_alice")));
});
