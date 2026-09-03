#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marker = `${repositoryRoot}/packages/bb-app/host-daemon/dist/daemon-bundle.mjs`;
const processes = spawnSync("/bin/ps", ["-axo", "command="], {
  encoding: "utf8",
});

if (processes.status !== 0) {
  console.error("STOP: cannot verify whether this checkout serves the live BB runtime.");
  process.exit(75);
}

if (processes.stdout.split("\n").some((line) => line.includes(marker))) {
  console.error(
    "STOP: this checkout still serves live BB provider sessions. " +
      "Do not rebuild it; wait for those sessions to finish and switch to bb-runtime/current.",
  );
  process.exit(75);
}
