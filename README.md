# Chinese Teaching Tools · Practice Classroom (Spark edition)

A modular classroom for Chinese teaching activities, assignments, recorded handwriting practice, and student submissions. This version uses **Firebase's free Spark plan**: Google Authentication, Firestore, and static Firebase Hosting. **No Cloud Functions, billing account, or Blaze activation is required.** Spark usage quotas still apply.

- Repository: https://github.com/fangdongyzu/chinese-teaching-tools
- Website: https://chinese-teaching-tools.web.app
- Firebase project: `chinese-teaching-tools`
- Firestore: native mode, Taiwan (`asia-east1`)

## Teacher workflow

1. Sign in with an authorized teacher Google account.
2. Create a stroke-order assignment with Chinese text, repetitions per character (1–50), guided tracing or writing from memory, an optional class, deadline, instructions, and student email roster.
3. Share the seven-character assignment code or link. No invitation emails are sent automatically.
4. Review student progress, per-character counts, submitted results, recorded stroke paths, browser-reported elapsed time, and mistakes. Replay saved strokes or export CSV results.
5. Close/reopen an assignment as needed. Assignment content and repetition targets are immutable after creation so previous results keep their meaning.

Each different character has one quota: `你好你好` with 5 repetitions means write `你` five times and `好` five times. Punctuation is ignored. Assignments support up to 80 different characters; stroke data is checked for availability before publishing.

An optional student email roster restricts who can join. With an empty roster, any Google-authenticated student with the code may join. Roster emails remain in teacher-only assignment records and are not exposed in student assignment summaries.

## Teacher access

The requested initial owners are:

- `tristanlpd@gm.lhu.edu.tw`
- `tristanlpd@gmail.com`

Both can add or remove other teacher Google emails under **Teacher access**. Additional teachers can create assignments and review results but cannot manage access. Initial owners cannot be removed through the interface. Firestore rules enforce roles using verified Google identities; students cannot grant themselves teacher access.

## Student workflow

1. Sign in with Google and join using a teacher's code or link.
2. Watch as needed; watching does not count.
3. Practice in the assigned mode. Writing from memory has no outline or automatic hints.
4. Complete each character's quota. The character row is directly below the writing box.
5. Press **Submit assignment** once every quota is complete. Results are saved to the Google account and can be resumed on another device.

## What Spark checks, and what it cannot prove

**The student's browser checks stroke geometry, direction, and order.** It saves the recorded paths for teacher review. Firestore rules cannot independently perform that geometric validation. A modified browser or automated client can fabricate plausible practice records. Saved records are evidence to review, not proof of human authorship.

Firestore security rules still enforce:

- verified Google sign-in, teacher/owner roles, and student data isolation;
- assignment roster restrictions, deadlines, and open/closed state;
- zero initial counts and immutable assignment/student identity fields;
- one count increment for one character, tied atomically to a completed attempt and fingerprint record;
- no count jumps, unrelated character changes, or increments above the teacher's quota;
- no duplicate count when saving the same attempt twice or retrying from concurrent tabs;
- exact path fingerprint reuse detection in the normal app;
- explicit submission only after all quotas are met, with immutable submitted results.

Counts, mistake totals, and elapsed-time totals are browser-reported. Server timestamps mark start/end and submission events, but do not prove continuous practice. The teacher result screen identifies this as browser-checked practice.

## Development

Requires Node.js 22.12+ and npm. Java 21 is needed for Firestore emulator tests.

```sh
npm ci
npm run dev
```

Vite serves `http://localhost:4180/`. The Firebase web configuration is intentionally public in `src/firebase-config.js`. No service-account keys or account credentials belong in the repository.

Development-only, clearly labeled interface previews:

- `http://localhost:4180/?preview=teacher`
- `http://localhost:4180/?preview=student`

These use sample data and cannot save or submit real work. The preview route is compiled out of production.

For Firebase emulators, run `firebase emulators:start --only auth,firestore` and set `VITE_USE_EMULATORS=true` while running Vite. The automated tests use mocked Google identities against the Firestore emulator, not real student accounts.

## Tests and deployment

```sh
npm test
npm run test:emulator
npm run build
npm run deploy
```

The emulator tests exercise the actual Spark data-access code with security rules enabled. They cover teacher access, private rosters, student isolation, direct tampering, quota enforcement, stored evidence, concurrent saves, immutable submission, and assignment closure.

Deployment builds the frontend and deploys **only Firestore rules/indexes and Hosting**. It does not enable billing, deploy functions, or create paid services. Google sign-in is already enabled for this project; the Firebase Hosting domains are authorized by default. If moving to another hostname, add it under Authentication → Settings → Authorized domains.

## Storage and privacy

Teacher-private settings live in `assignments`. Student-safe assignment summaries live at `assignmentCodes/{code}`; code collection listing is restricted to teachers. Progress is stored in `enrollments` as a map keyed by character, and normalized to arrays for the interface. Started/completed attempts store stroke evidence in `attempts`; exact-path fingerprints are under the student's enrollment. Final results are immutable `submissions`.

All writes come from authenticated browsers and are constrained by Firestore security rules. There is no server-admin write bypass in the application. No email, analytics, or cloud storage upload is sent automatically. Character JSON is fetched from pinned jsDelivr data URLs; fonts use Google Fonts with system fallbacks.

## Adding another teaching activity

1. Register display metadata in `src/activities.js`.
2. Add its student interface and browser validation under `src/activities/` and/or `src/domain.js`.
3. Extend `src/classroom-store.js` for its assignment/attempt data.
4. Update `firestore.rules` to protect its writes and add emulator tests.
5. Reuse Google login, teacher access, enrollment, review, and submission flows.

The initial activity is stroke-order practice. No placeholder programs are presented as available activities.

## Attribution

Hanzi Writer 3.7.3 is MIT-licensed. Hanzi Writer Data 2.0.1 derives from Make Me a Hanzi / Arphic fonts, under the Arphic Public License. Stroke forms and orders can differ from regional teaching standards. See `THIRD_PARTY_NOTICES.md` and `public/licenses/`. Test JSON fixtures are unmodified excerpts of the same data.
