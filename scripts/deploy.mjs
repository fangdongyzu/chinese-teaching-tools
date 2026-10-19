import { spawnSync } from "node:child_process";
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
run("npm", ["run", "build"]);
run("firebase", [
  "deploy",
  "--only",
  "firestore,hosting",
  "--project",
  "chinese-teaching-tools",
  "--non-interactive",
]);
