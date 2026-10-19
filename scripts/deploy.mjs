import { spawnSync } from "node:child_process";
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
// The functions step must succeed before enabling production sign-in. This
// never links a billing account or upgrades the Firebase plan automatically.
run("firebase", [
  "deploy",
  "--only",
  "firestore,functions",
  "--project",
  "chinese-teaching-tools",
  "--non-interactive",
]);
run("npm", ["run", "build"], { VITE_BACKEND_READY: "true" });
run("firebase", [
  "deploy",
  "--only",
  "hosting",
  "--project",
  "chinese-teaching-tools",
  "--non-interactive",
]);
