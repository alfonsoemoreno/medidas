import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

const child = spawn(
  isWindows ? "npx" : "npx",
  ["next", "build", "--webpack"],
  {
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      DESKTOP_BUILD: "true",
    },
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
