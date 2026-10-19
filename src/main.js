import "./style.css";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import {
  configured,
  enrollmentRecord,
  assignmentFromEnrollment,
  auth,
  db,
  observeAuth,
  login,
  logout,
  call,
} from "./api.js";
import { ACTIVITIES, activityName } from "./activities.js";
import {
  escape as e,
  dateLabel,
  duration,
  progress,
  toast,
  errorMessage,
  csv,
  timeValue,
} from "./utils.js";
import { mountPractice, cleanupPractice } from "./activities/stroke-order.js";
const app = document.getElementById("app"),
  dialog = document.getElementById("dialog");
let subscriptionRevision = 0;
const previewMode = new URLSearchParams(location.search).get("preview");
const preview =
  import.meta.env.DEV && ["teacher", "student"].includes(previewMode);
const state = {
  user: null,
  profile: null,
  tab: "assignments",
  studentView: false,
  assignments: [],
  enrollments: [],
  teachers: [],
  loading: true,
  practice: null,
  error: "",
  unsub: [],
};
const isTeacher = () =>
  state.profile && ["teacher", "owner"].includes(state.profile.role);
const teacherView = () => isTeacher() && !state.studentView;
const personal = () =>
  state.enrollments.filter((r) => r.userId === state.user?.uid);
const hasExpired = (a) => a.dueAt && timeValue(a.dueAt) < Date.now();
const button = (label, action, id = "", classes = "") =>
  `<button class="btn ${classes}" data-action="${action}" ${id ? `data-id="${e(id)}"` : ""} ${action === "login" && !configured ? "disabled" : ""}>${label}</button>`;
const badge = (a) =>
  `<span class="badge ${a.status === "closed" || hasExpired(a) ? "gray" : ""}">${hasExpired(a) ? "Past due" : a.status === "closed" ? "Closed" : "Open"}</span>`;
function header() {
  return `<header><a class="brand" href="./"><span class="seal" lang="zh">課</span><span>practice classroom<small>CHINESE TEACHING TOOLS</small></span></a><div class="account">${state.profile ? `<div class="account-info">${e(state.profile.name)}<span>${e(state.profile.email)}</span></div><span class="badge gray">${teacherView() ? "Teacher" : "Student"}</span>${button("Sign out", "logout", "", "small")}` : button('<span class="google-g">G</span> Sign in with Google', "login", "", "primary")}</div></header>`;
}
function navigation() {
  const rows = teacherView()
    ? [
        ["assignments", "▤", "Assignments"],
        ["activities", "◇", "Activity library"],
        ["teachers", "♙", "Teacher access"],
      ]
    : [["assignments", "▤", "My assignments"]];
  return `<aside class="side"><div class="side-label">YOUR CLASSROOM</div>${rows.map(([id, icon, label]) => `<button data-action="tab" data-id="${id}" class="${state.tab === id ? "active" : ""}"><span>${icon}</span>${label}</button>`).join("")}${isTeacher() ? `<div class="spacer"></div><button data-action="switch-view"><span>⇄</span>${teacherView() ? "Student interface" : "Teacher interface"}</button>` : ""}<div class="side-note">One place for your class.<br>More activities can be added to the library later.</div></aside>`;
}
function shell(content) {
  return `<div class="shell">${header()}${preview ? `<div class="banner preview"><span>Interface preview · sample data · no real accounts or results</span><a href="./">Exit preview</a></div>` : ""}${state.profile ? `<div class="workspace">${navigation()}<main class="main" id="main-content">${content}</main></div>` : `<main>${content}</main>`}<footer class="footer"><span>Practice Classroom · Learn through practice.</span><span>Google sign-in · Firebase</span></footer></div>`;
}
function landing() {
  return `<section class="landing"><div class="landing-content"><div><div class="eyebrow">YOUR WORDS. THEIR PRACTICE.</div><h1>A little practice.<br>Progress you can see.</h1><p>A classroom for Chinese assignments. Teachers set the task; students practice each character and submit their recorded results.</p>${button('<span class="google-g">G</span> Continue with Google', "login", "", "primary")}<p class="login-caption">Use your teacher or student Google account.<br>Your teacher shares an assignment code to get you started.</p>${!configured ? '<div class="banner">Firebase configuration is not complete yet.</div>' : ""}${state.error ? `<div class="banner">${e(state.error)}</div>` : ""}</div><div class="login-panel"><div class="paper-mark" lang="zh">學 習</div><ul><li><span>01</span> Your teacher assigns text and a practice target.</li><li><span>02</span> Write each character the required number of times.</li><li><span>03</span> Submit your results for your teacher to review.</li></ul></div></div></section>`;
}
function teacherAssignments() {
  const submissions = state.enrollments.filter(
    (r) => r.status === "submitted",
  ).length;
  return `<div class="page-heading"><div><div class="eyebrow">TEACHER WORKSPACE</div><h1>Your assignments</h1><p class="muted">Set the practice. See the progress.</p></div>${button("＋ New assignment", "new-assignment", "", "primary")}</div><div class="stats"><div class="stat"><strong>${state.assignments.filter((a) => a.status === "open" && !hasExpired(a)).length}</strong><span>Open assignments</span></div><div class="stat"><strong>${new Set(state.enrollments.map((r) => r.userId)).size}</strong><span>Students joined</span></div><div class="stat"><strong>${submissions}</strong><span>Submitted results</span></div></div><section class="panel"><div class="panel-heading"><h2>All assignments</h2><span class="muted" style="font-size:10px">${state.assignments.length} total</span></div>${
    state.assignments.length
      ? `<div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Practice</th><th>Code</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>${state.assignments
          .map((a) => {
            const joined = state.enrollments.filter(
              (r) => r.assignmentId === a.id,
            );
            return `<tr><td><strong>${e(a.title)}</strong><small>${e(a.className || activityName(a.activityType))}<br>${a.dueAt ? "Due " + e(dateLabel(a.dueAt)) : "No due date"}</small></td><td>${a.characters.length} characters × ${a.repetitions}<small>${a.mode === "write" ? "Write from memory" : "Guided tracing"}</small></td><td><code>${e(a.code)}</code></td><td>${joined.filter((r) => r.status === "submitted").length} / ${joined.length}<small>of joined students</small></td><td>${badge(a)}</td><td>${button("Review", "review-assignment", a.id, "small")}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<div class="empty"><span class="empty-symbol">▤</span>No assignments yet.<br>Create your first stroke-order assignment.</div>'
  }</section>`;
}
function activities() {
  return `<div class="page-heading"><div><div class="eyebrow">ACTIVITY LIBRARY</div><h1>Tools for your classroom</h1><p class="muted">Choose an activity to turn into an assignment.</p></div></div>${ACTIVITIES.map((a) => `<section class="panel activity-card"><div class="activity-icon" lang="zh">${e(a.icon)}</div><div><span class="badge">Available</span><h3 style="margin-top:10px">${e(a.name)} <small class="muted" style="font:14px serif">${e(a.chinese)}</small></h3><p>${e(a.description)}</p></div>${button("Create assignment ↗", "new-assignment", a.id, "primary")}</section>`).join("")}<p class="muted">This library is built to grow. New test and assignment programs can use the same sign-in, teacher access, and submission system.</p>`;
}
function teacherAccess() {
  const initial = ["tristanlpd@gm.lhu.edu.tw", "tristanlpd@gmail.com"];
  const rows = [
    ...initial.map((email) => ({ email, role: "owner" })),
    ...state.teachers.filter((t) => !initial.includes(t.email)),
  ];
  return `<div class="page-heading"><div><div class="eyebrow">CLASSROOM SETTINGS</div><h1>Teacher access</h1><p class="muted">Choose which Google email addresses can manage assignments.</p></div></div><section class="panel"><div class="teacher-list">${rows.map((t) => `<div class="teacher-row"><div><strong>${e(t.email)}</strong><small>${t.role === "owner" ? "Initial owner · manages teacher access" : "Teacher · creates assignments and reviews results"}</small></div>${t.role === "owner" ? '<span class="badge">Owner</span>' : state.profile.role === "owner" ? button("Remove", "remove-teacher", t.email, "small danger") : '<span class="badge gray">Teacher</span>'}</div>`).join("")}</div>${state.profile.role === "owner" ? `<form id="teacher-form" class="teacher-form"><div class="field"><label for="teacher-email">Add a teacher’s Google email</label><input id="teacher-email" type="email" required maxlength="254" placeholder="teacher@example.com"></div><button class="btn primary" type="submit">Add teacher</button></form>` : '<p class="muted">Only the initial owners can add or remove teacher access.</p>'}</section>`;
}
function studentAssignments() {
  const rows = personal();
  return `<div class="page-heading"><div><div class="eyebrow">STUDENT WORKSPACE</div><h1>My assignments</h1><p class="muted">A little progress, one character at a time.</p></div></div><section class="panel join-panel"><div><h3>Have an assignment code?</h3><p class="muted" style="margin:0">Enter the seven-character code from your teacher.</p></div><form class="inline-form" id="join-form"><label class="field"><span class="muted" style="font-size:10px">Assignment code</span><input id="join-code" maxlength="7" minlength="7" required autocomplete="off" placeholder="ABC2345" aria-label="Assignment code"></label><button class="btn primary" type="submit" style="align-self:flex-end">Join assignment</button></form></section><div class="assignment-grid">${rows
    .map((r) => {
      const p = progress(r),
        a = state.assignments.find((a) => a.id === r.assignmentId);
      return `<section class="panel assignment-card"><div class="card-top"><span class="eyebrow" style="margin:0">筆順 · STROKE ORDER</span><span class="badge ${r.status === "submitted" ? "" : "gray"}">${r.status === "submitted" ? "Submitted" : "In progress"}</span></div><div><h2>${e(r.title)}</h2><p class="muted">${e(r.className)} ${r.className ? "·" : ""} ${r.repetitions} repetitions per character</p></div><div class="character-preview" lang="zh">${e(r.characters.join(""))}</div><div><div class="progress-label"><span>${p.done} / ${p.target} repetitions</span><span>${p.percent}%</span></div><progress value="${p.done}" max="${p.target}" aria-label="${e(r.title)} progress"></progress></div><div class="card-bottom"><span class="muted" style="font-size:10px">${r.status === "submitted" ? "Submitted " + dateLabel(r.submittedAt) : a?.dueAt ? "Due " + dateLabel(a.dueAt) : "No due date"}</span>${button(r.status === "submitted" ? "View results" : p.percent === 100 ? "Review & submit" : "Continue practice ↗", "open-practice", r.assignmentId, r.status === "submitted" ? "small" : "small primary")}</div></section>`;
    })
    .join(
      "",
    )}</div>${!rows.length ? '<div class="panel empty"><span class="empty-symbol">✎</span>Your assignments will appear here after you join with a code.</div>' : ""}`;
}
function render() {
  if (state.practice) return;
  cleanupPractice();
  if (!state.user) {
    app.innerHTML = shell(landing());
    return;
  }
  if (state.loading) {
    app.innerHTML = shell('<div class="loading">Opening your classroom…</div>');
    return;
  }
  if (!state.profile) {
    app.innerHTML = shell(
      `<section class="landing"><h1>Finish connecting your classroom</h1><div class="banner">${e(state.error || "The server is not available yet. Please contact your teacher.")}</div>${button("Try again", "reload-session", "", "primary")} ${button("Sign out", "logout")}</section>`,
    );
    return;
  }
  app.innerHTML = shell(
    teacherView()
      ? state.tab === "activities"
        ? activities()
        : state.tab === "teachers"
          ? teacherAccess()
          : teacherAssignments()
      : studentAssignments(),
  );
  wireForms();
}
function stopListeners() {
  subscriptionRevision++;
  state.unsub.forEach((fn) => fn());
  state.unsub = [];
}
function subscribe() {
  stopListeners();
  const revision = subscriptionRevision;
  const asTeacher = teacherView();
  const onError = (error) => {
    if (revision === subscriptionRevision) toast(errorMessage(error), true);
  };
  const update = () => {
    if (!state.practice) render();
  };
  const enrollQuery = teacherView()
    ? collection(db, "enrollments")
    : query(
        collection(db, "enrollments"),
        where("userId", "==", state.user.uid),
      );
  state.unsub.push(
    onSnapshot(
      enrollQuery,
      async (snapshot) => {
        try {
          const enrollments = snapshot.docs.map(enrollmentRecord);
          const assignments = asTeacher
            ? null
            : await Promise.all(enrollments.map(assignmentFromEnrollment));
          if (revision !== subscriptionRevision) return;
          state.enrollments = enrollments;
          if (assignments) state.assignments = assignments;
          update();
        } catch (error) {
          onError(error);
        }
      },
      onError,
    ),
  );
  if (teacherView()) {
    state.unsub.push(
      onSnapshot(
        collection(db, "assignments"),
        (snapshot) => {
          if (revision !== subscriptionRevision) return;
          state.assignments = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
          update();
        },
        onError,
      ),
    );
    state.unsub.push(
      onSnapshot(
        collection(db, "teachers"),
        (snapshot) => {
          if (revision !== subscriptionRevision) return;
          state.teachers = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          update();
        },
        onError,
      ),
    );
  }
}
async function bootstrap(user) {
  state.user = user;
  state.profile = null;
  state.loading = Boolean(user);
  state.error = "";
  state.practice = null;
  stopListeners();
  render();
  if (!user) return;
  try {
    state.profile = await call("bootstrapSession");
    state.loading = false;
    state.tab = "assignments";
    subscribe();
    render();
    const join = new URLSearchParams(location.search).get("join");
    if (join) {
      state.studentView = true;
      await joinCode(join);
      history.replaceState({}, "", location.pathname);
      subscribe();
    }
  } catch (error) {
    state.loading = false;
    state.error = errorMessage(error);
    render();
  }
}
function openDialog(content) {
  dialog.innerHTML = content;
  dialog.showModal();
}
const dialogHead = (title) =>
  `<div class="dialog-head"><div><div class="eyebrow">PRACTICE CLASSROOM</div><h2>${e(title)}</h2></div><button class="close" data-action="close-dialog" aria-label="Close dialog">×</button></div>`;
function newAssignment() {
  openDialog(
    `${dialogHead("Create an assignment")}<form id="assignment-form"><div class="form-grid"><div class="field full"><label for="assignment-title">Assignment title</label><input id="assignment-title" name="title" required minlength="2" maxlength="120" placeholder="Week 1 · Everyday Chinese"></div><div class="field"><label for="assignment-class">Class / group</label><input id="assignment-class" name="className" maxlength="100" placeholder="Chinese 101"></div><div class="field"><label for="assignment-due">Due date (optional)</label><input id="assignment-due" name="dueAt" type="datetime-local"></div><div class="field full"><label for="assignment-text">Text to practice · 繁體 / 简体</label><textarea class="chinese" id="assignment-text" name="text" required maxlength="10000" placeholder="你好世界學習中文"></textarea><small>Up to 80 different Chinese characters. Punctuation is ignored. Repeated characters share one practice quota.</small></div><div class="field"><label for="assignment-repetitions">Repetitions for every character</label><input id="assignment-repetitions" name="repetitions" type="number" min="1" max="50" step="1" value="5" required></div><div class="field"><label for="assignment-mode">Practice mode</label><select id="assignment-mode" name="mode"><option value="write">Write from memory · no hints</option><option value="trace">Guided tracing</option></select></div><div class="field full"><label for="assignment-students">Assign to student Google emails (optional)</label><textarea id="assignment-students" name="studentEmails" placeholder="student1@example.com&#10;student2@example.com"></textarea><small>Separate addresses with commas or new lines. Leave blank to allow any signed-in student with the assignment code. No email is sent automatically.</small></div><div class="field full"><label for="assignment-instructions">Instructions (optional)</label><textarea id="assignment-instructions" name="instructions" maxlength="2000" placeholder="Instructions for your students"></textarea></div></div><div class="form-error" id="assignment-error" role="alert"></div><div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">Create & get code ↗</button></div></form>`,
  );
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const f = new FormData(event.target),
      submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    dialog.querySelector("#assignment-error").textContent = "";
    try {
      if (preview)
        throw new Error(
          "This is an interface preview. Sign in to create a real assignment.",
        );
      const result = await call("createAssignment", {
        activityType: "stroke-order",
        title: f.get("title"),
        className: f.get("className"),
        text: f.get("text"),
        repetitions: Number(f.get("repetitions")),
        mode: f.get("mode"),
        dueAt: f.get("dueAt") ? new Date(f.get("dueAt")).getTime() : null,
        studentEmails: String(f.get("studentEmails"))
          .split(/[\s,;]+/)
          .filter(Boolean),
        instructions: f.get("instructions"),
      });
      openDialog(
        `${dialogHead("Your assignment is ready")}<p>Share this code with your students. They sign in with Google and join the assignment.</p><div class="panel" style="text-align:center;background:#edf2e7"><code style="font-size:35px;letter-spacing:6px">${e(result.code)}</code></div><p class="muted">Student link</p><input readonly aria-label="Student assignment link" value="${e(location.origin + location.pathname + "?join=" + result.code)}"><div class="form-actions">${button("Copy code", "copy-code", result.code, "primary")}${button("Done", "close-dialog")}</div>`,
      );
    } catch (error) {
      dialog.querySelector("#assignment-error").textContent =
        errorMessage(error);
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  };
}
async function joinCode(code) {
  if (preview) throw new Error("Sign in to join a real assignment.");
  const result = await call("joinAssignment", { code });
  toast("Assignment joined. Your progress will be saved to your account.");
  return result;
}
function wireForms() {
  document
    .getElementById("join-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = event.target.querySelector("button");
      btn.disabled = true;
      try {
        await joinCode(document.getElementById("join-code").value);
      } catch (error) {
        toast(errorMessage(error), true);
      } finally {
        btn.disabled = false;
      }
    });
  document
    .getElementById("teacher-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = event.target.querySelector("button");
      btn.disabled = true;
      try {
        if (preview) throw new Error("Sign in to change real teacher access.");
        await call("setTeacherAccess", {
          email: document.getElementById("teacher-email").value,
          enabled: true,
        });
        toast("Teacher access added.");
        event.target.reset();
      } catch (error) {
        toast(errorMessage(error), true);
      } finally {
        btn.disabled = false;
      }
    });
}
async function reviewAssignment(id) {
  const a = state.assignments.find((a) => a.id === id);
  const members = state.enrollments.filter((r) => r.assignmentId === id);
  openDialog(
    `${dialogHead(a.title)}<div class="panel-heading"><span><code>${e(a.code)}</code> ${badge(a)}</span><div>${button("Copy code", "copy-code", a.code, "small")}${button(a.status === "open" ? "Close assignment" : "Reopen", "toggle-assignment", a.id, "small")}</div></div><p class="muted">${a.characters.length} characters × ${a.repetitions} repetitions · ${a.mode === "write" ? "Write from memory" : "Guided tracing"}</p>${a.studentEmails.length ? `<p class="muted">Assigned emails: ${e(a.studentEmails.join(", "))}</p>` : '<p class="muted">Any signed-in student with the code can join.</p>'}<div class="table-wrap"><table><thead><tr><th>Student</th><th>Recorded</th><th>Status</th><th></th></tr></thead><tbody>${members
      .map((r) => {
        const p = progress(r);
        return `<tr><td><strong>${e(r.studentName)}</strong><small>${e(r.studentEmail)}</small></td><td>${p.done} / ${p.target}</td><td><span class="badge ${r.status === "submitted" ? "" : "gray"}">${r.status === "submitted" ? "Submitted" : "Practicing"}</span></td><td>${button("Details", "review-student", r.id, "small")}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table>${!members.length ? '<div class="empty">No students have joined yet.</div>' : ""}</div><div class="form-actions">${button("Export results CSV", "export-results", id)}${button("Done", "close-dialog", "", "primary")}</div>`,
  );
}
async function reviewStudent(id) {
  const r = state.enrollments.find((r) => r.id === id);
  openDialog(
    `${dialogHead(r.studentName)}<p class="muted">${e(r.studentEmail)} · ${e(r.title)}</p><div class="details-list"><div><small>Status</small>${r.status === "submitted" ? "Submitted " + e(dateLabel(r.submittedAt)) : "In progress · not submitted"}</div><div><small>Recorded repetitions</small>${progress(r).done} / ${progress(r).target}</div><div><small>Reported elapsed time</small>${duration(r.totalElapsedMs)}</div><div><small>Reported try-agains</small>${r.totalMistakes}</div></div><div class="evidence-grid">${r.characters.map((char, i) => `<div class="evidence-item"><strong>${e(char)}</strong><small>${r.counts[i]} / ${r.repetitions}</small></div>`).join("")}</div><h3>Recorded practice attempts</h3><p class="muted">Spark edition: strokes, counts, and timing are reported by the student’s browser. Saved stroke paths support teacher review; they are not independent proof of practice or human authorship.</p><div id="attempt-list" class="loading">Loading recorded attempts…</div><div class="form-actions">${button("Back to assignment", "review-assignment", r.assignmentId)}</div>`,
  );
  try {
    let attempts;
    if (preview) attempts = [];
    else {
      const snapshot = await getDocs(
        query(
          collection(db, "attempts"),
          where("assignmentId", "==", r.assignmentId),
          where("userId", "==", r.userId),
        ),
      );
      attempts = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.status === "completed")
        .sort((a, b) => timeValue(b.endedAt) - timeValue(a.endedAt));
    }
    const target = dialog.querySelector("#attempt-list");
    if (!target) return;
    target.className = "";
    target.innerHTML = attempts.length
      ? `<div class="table-wrap"><table><thead><tr><th>Character</th><th>Time</th><th>Try-agains</th><th></th></tr></thead><tbody>${attempts.map((a, i) => `<tr><td><strong lang="zh">${e(a.character)}</strong></td><td>${duration(a.elapsedMs)}</td><td>${a.mistakes}</td><td><button class="btn small" data-replay="${i}">Replay strokes</button></td></tr>`).join("")}</tbody></table></div><div id="replay-target"></div>`
      : '<p class="muted">No completed attempts recorded yet.</p>';
    target.onclick = (event) => {
      const btn = event.target.closest("[data-replay]");
      if (btn)
        replayAttempt(
          attempts[Number(btn.dataset.replay)],
          dialog.querySelector("#replay-target"),
        );
    };
  } catch (error) {
    const target = dialog.querySelector("#attempt-list");
    if (target) {
      target.className = "";
      target.textContent = errorMessage(error);
    }
  }
}
function replayAttempt(attempt, target) {
  target.innerHTML = `<div class="evidence-replay"><svg viewBox="0 0 1024 1024" aria-label="Recorded handwriting for ${e(attempt.character)}"><g transform="translate(0 900) scale(1 -1)">${attempt.strokes.map((stroke) => `<path d="M ${stroke.points.map((p) => `${p.x} ${p.y}`).join(" L ")}"/>`).join("")}</g></svg></div><p class="muted" style="text-align:center">${e(attempt.character)} · ${dateLabel(attempt.endedAt)} · ${attempt.strokes.length} recorded strokes</p>`;
  target.querySelectorAll("path").forEach((path, i) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration: 400,
      delay: i * 500,
      fill: "both",
      easing: "linear",
    });
  });
  target.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
async function openPractice(id) {
  const enrollment = personal().find((r) => r.assignmentId === id);
  if (!enrollment) {
    toast("Join the assignment first.", true);
    return;
  }
  let assignment = state.assignments.find((a) => a.id === id);
  if (!assignment && !preview) {
    assignment = await assignmentFromEnrollment(enrollment);
  }
  if (!assignment) {
    toast("Assignment not found.", true);
    return;
  }
  state.practice = id;
  app.innerHTML = shell("");
  const root = document.getElementById("main-content");
  await mountPractice(root, assignment, structuredClone(enrollment), {
    call,
    preview,
    back: () => {
      state.practice = null;
      render();
    },
    refresh: async () => {
      if (!preview) {
        const snap = await getDoc(doc(db, "enrollments", enrollment.id));
        if (snap.exists()) {
          const updated = enrollmentRecord(snap);
          state.enrollments = state.enrollments.map((r) =>
            r.id === updated.id ? updated : r,
          );
        }
      }
    },
  });
}
async function action(event) {
  const b = event.target.closest("[data-action]");
  if (!b) return;
  const name = b.dataset.action,
    id = b.dataset.id;
  try {
    if (name === "login") {
      if (!configured) throw new Error("Firebase setup is not complete.");
      await login();
    } else if (name === "logout") {
      cleanupPractice();
      state.practice = null;
      if (preview) location.href = "./";
      else await logout();
    } else if (name === "reload-session") await bootstrap(auth.currentUser);
    else if (name === "tab") {
      state.tab = id;
      render();
    } else if (name === "switch-view") {
      state.studentView = !state.studentView;
      state.practice = null;
      state.tab = "assignments";
      if (!preview) subscribe();
      render();
    } else if (name === "new-assignment") newAssignment();
    else if (name === "close-dialog") dialog.close();
    else if (name === "copy-code") {
      await navigator.clipboard.writeText(id);
      toast("Assignment code copied.");
    } else if (name === "review-assignment") await reviewAssignment(id);
    else if (name === "review-student") await reviewStudent(id);
    else if (name === "open-practice") await openPractice(id);
    else if (name === "toggle-assignment") {
      if (preview) throw new Error("Sign in to change a real assignment.");
      b.disabled = true;
      const a = state.assignments.find((a) => a.id === id);
      await call("setAssignmentStatus", {
        assignmentId: id,
        status: a.status === "open" ? "closed" : "open",
      });
      dialog.close();
      toast("Assignment updated.");
    } else if (name === "remove-teacher") {
      if (preview) throw new Error("Sign in to manage real teacher access.");
      b.disabled = true;
      await call("setTeacherAccess", { email: id, enabled: false });
      toast("Teacher access removed.");
    } else if (name === "export-results") {
      const a = state.assignments.find((a) => a.id === id);
      const rows = [
        [
          "Assignment",
          "Student",
          "Email",
          "Status",
          "Recorded repetitions",
          "Required repetitions",
          "Elapsed seconds",
          "Reported try-agains",
          "Submitted at",
          ...a.characters,
        ],
        ...state.enrollments
          .filter((r) => r.assignmentId === id)
          .map((r) => [
            a.title,
            r.studentName,
            r.studentEmail,
            r.status,
            progress(r).done,
            progress(r).target,
            Math.round(r.totalElapsedMs / 1000),
            r.totalMistakes,
            r.submittedAt
              ? new Date(timeValue(r.submittedAt)).toISOString()
              : "",
            ...r.counts,
          ]),
      ];
      const url = URL.createObjectURL(
        new Blob(["\ufeff" + csv(rows)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `assignment-${a.code}-results.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    toast(errorMessage(error), true);
    if (b.isConnected) b.disabled = false;
  }
}
app.addEventListener("click", action);
dialog.addEventListener("click", action);
if (preview) {
  const now = Date.now();
  state.user = { uid: "preview-student" };
  state.profile = {
    uid: state.user.uid,
    name: previewMode === "teacher" ? "Tristan" : "Jamie Chen",
    email:
      previewMode === "teacher"
        ? "tristanlpd@gm.lhu.edu.tw"
        : "student@example.com",
    role: previewMode === "teacher" ? "owner" : "student",
  };
  state.loading = false;
  state.assignments = [
    {
      id: "preview-1",
      title: "Week 1 · Everyday Chinese",
      className: "Chinese 101",
      characters: Array.from("你好世界學習中文"),
      text: "你好世界學習中文",
      repetitions: 5,
      mode: "write",
      status: "open",
      activityType: "stroke-order",
      code: "XUE2345",
      dueAt: now + 86400000 * 3,
      studentEmails: [],
      instructions:
        "Practice each character five times, then submit your results.",
    },
    {
      id: "preview-2",
      title: "A little practice every day",
      className: "Chinese 101",
      characters: Array.from("日月山水"),
      text: "日月山水",
      repetitions: 3,
      mode: "trace",
      status: "open",
      activityType: "stroke-order",
      code: "INK6789",
      dueAt: null,
      studentEmails: [],
      instructions: "",
    },
  ];
  state.enrollments = [
    {
      id: "preview-1_preview-student",
      assignmentId: "preview-1",
      userId: "preview-student",
      studentName: "Jamie Chen",
      studentEmail: "student@example.com",
      title: state.assignments[0].title,
      className: "Chinese 101",
      characters: state.assignments[0].characters,
      repetitions: 5,
      counts: [5, 5, 3, 0, 0, 0, 0, 0],
      status: "in-progress",
      totalMistakes: 7,
      totalElapsedMs: 364000,
    },
    {
      id: "preview-2_preview-student",
      assignmentId: "preview-2",
      userId: "preview-student",
      studentName: "Jamie Chen",
      studentEmail: "student@example.com",
      title: state.assignments[1].title,
      className: "Chinese 101",
      characters: state.assignments[1].characters,
      repetitions: 3,
      counts: [3, 3, 3, 3],
      status: "submitted",
      submittedAt: now - 86400000,
      totalMistakes: 3,
      totalElapsedMs: 221000,
    },
  ];
  render();
} else {
  render();
  observeAuth(bootstrap);
}
