// Static build of the POS for the desktop app (see next.config.js). A Node script rather than
// `NEXT_OUTPUT=export next build` so it also works in the Windows shell on the release runner.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_OUTPUT: "export" },
});
process.exit(result.status ?? 1);
