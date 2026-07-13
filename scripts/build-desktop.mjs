import { spawn } from "node:child_process";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build", "--webpack"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DESKTOP_BUILD: "true",
    },
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
