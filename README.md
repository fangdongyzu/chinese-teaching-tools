# Chinese Teaching Tools · Practice Classroom

A modular Firebase classroom with separate teacher and student interfaces. Stroke order practice is the first activity; more test and assignment programs can be added later.

## Project

- Firebase project: **chinese-teaching-tools**
- Firestore: native mode, **asia-east1 (Taiwan)**
- Cloud Functions: Node.js 22, **asia-east1**, maximum 3 instances per function
- Website: Firebase Hosting, with relative asset paths compatible with repository hosting
- Google is the only sign-in provider accepted by the app and backend

## Current activation status

The new Firebase project starts on the free Spark plan. **Production Cloud Functions require the Blaze plan.** Billing is not enabled automatically. Until the backend is deployed successfully, the production build displays an activation notice and disables sign-in rather than accepting work that cannot be recorded.

The Firebase web app and database are created and Google sign-in is enabled. The source is configured for the new project. Run `npm run deploy` after the project owner enables Blaze in the Firebase console. That command deploys the server and rules first, then enables the public interface and publishes Hosting. There are no service-account keys in this repository.

## Teacher workflow

1. Sign in with Google using an authorized teacher account.
2. Create a stroke-order assignment. Choose a title, class, Chinese text, repetitions per character (1–50), guided tracing or writing from memory, and an optional deadline.
3. Optionally restrict the assignment to a list of student Google emails. A blank roster allows any Google-authenticated student who has the assignment code. No invitation email is sent automatically.
4. Share the seven-character code or assignment link.
5. Review enrolled students, counts for every character, submission status, recorded stroke paths, elapsed time, and browser-reported mistakes. Replay recorded attempts or export a CSV.
6. Close an assignment to stop new practice and submissions. Assignment content is immutable after creation to preserve the meaning of existing results.

Each distinct character in the passage has one quota. For example, `你好你好` with a target of 5 means 5 repetitions of `你` and 5 of `好`. Punctuation is ignored. An assignment supports up to 80 different characters and rejects unavailable stroke data before publishing.

## Teacher access

These two requested accounts are initial owners:

- `tristanlpd@gm.lhu.edu.tw`
- `tristanlpd@gmail.com`

Owners can add/remove other Google emails under **Teacher access**. Additional teachers can create assignments and review results but cannot change teacher access. Students cannot promote themselves. Initial owner access is protected against removal in the interface. Ownership is based on verified Google identities, not on a browser-local flag.

## Student workflow

1. Sign in with Google.
2. Join using the teacher’s code, or open the shared assignment link.
3. Watch as needed; watching does not count toward the assignment.
4. Complete each character in the teacher-selected mode and repeat until its target is met. Character navigation sits directly below the writing box.
5. The server checks each completed repetition, saves its stroke evidence, and increments the count atomically. A new repetition must be handwritten; replaying an identical stored path does not count.
6. Once every quota is met, press **Submit assignment**. Submission is explicit and immutable. Resuming on another device uses the same Firebase account and saved progress.

## Evidence and limits

All progress and submission writes are server-only. Firestore rules reject direct browser writes to assignments, roles, attempts, enrollment counts, and submissions. Server validation checks the number, order, direction, position, shape, and length of submitted strokes against pinned Hanzi data. Transactions and idempotent attempt IDs prevent duplicate counts from retries/concurrent tabs. Exact previously counted path fingerprints are rejected.

This provides practice evidence, **not proof of human authorship**. A sufficiently motivated user can automate geometric paths. Elapsed time is measured from a server-created attempt and can include pauses; mistake counts are reported by the client. Teachers should interpret both accordingly. Stroke forms/order follow Make Me a Hanzi and can differ from regional standards.

## Local development

Requires Node.js **22.12+**, npm, and Java 21 for Firestore emulator tests.

```sh
npm ci
npm ci --prefix functions
npm run dev
```

Public Firebase web configuration is in `src/firebase-config.js`. It is intended to be public; authorization is enforced by Firebase Authentication, security rules, and server functions.

Development-only interface previews (clearly labeled sample data; cannot record or submit real work):

- `http://localhost:4180/?preview=teacher`
- `http://localhost:4180/?preview=student`

Preview account switching is compiled out of production. To use local services, set `VITE_USE_EMULATORS=true` while running Vite, and run `firebase emulators:start --only auth,firestore,functions` separately. Production accepts verified Google identities only; use the emulator integration tests for deterministic backend fixtures.

## Tests and build

```sh
npm test
npm run test:emulator
npm run build
```

Tests cover Google identity requirements, owner access, repetition limits, character validation, backward and out-of-order strokes, replay fingerprints, Firestore role/student isolation, denied browser writes, roster enforcement, concurrent/idempotent completion, required quotas, immutable submission, and assignment closure.

## Deployment

```sh
# After the Firebase owner enables the Blaze plan:
npm run deploy
```

`npm run deploy` will not enable billing itself. It deploys the functions/security rules, builds the frontend with `VITE_BACKEND_READY=true`, then publishes Hosting. If functions fail to deploy, it exits before enabling sign-in.

For a setup-in-progress landing page on the free plan:

```sh
npm run build
npx firebase deploy --only firestore,hosting --project chinese-teaching-tools
```

The default build deliberately keeps sign-in disabled until the backend activation build is used. Firebase Hosting's built-in authorized domains are used for Google sign-in. If moving to GitHub Pages later, add the hostname under Authentication → Settings → Authorized domains.

## Add another activity

1. Add its display metadata in `src/activities.js`.
2. Add its student interface in `src/activities/`.
3. Add its server validator/normalizer in `functions/activities/`, then register it in the server assignment handlers. Never trust client-computed completion counts.
4. Reuse Google sign-in, enrollment, teacher access, and result review; extend the assignment/submission schema for the new activity.
5. Add permission and completion tests before making the activity available.

## Attribution

Hanzi Writer 3.7.3 is MIT-licensed. Hanzi Writer Data 2.0.1 is derived from Make Me a Hanzi / Arphic fonts, under the Arphic Public License. See `THIRD_PARTY_NOTICES.md` and `public/licenses/`.
