const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "tools/archguard/index.js");

test("doctor passes on repository config", () => {
  const output = execFileSync("node", [cliPath, "doctor"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /Archguard Doctor Report/);
  assert.match(output, /No config issues found\./);
});

test("check runs and prints report", () => {
  const output = execFileSync("node", [cliPath, "check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /Archguard Report/);
  assert.match(output, /Violations:/);
});
