const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  createFindingFingerprint,
  createBaselineDocument,
  loadBaselineDocument,
  buildBaselineSet,
  splitFindingsByBaseline
} = require("../tools/archguard/lib/baseline");

test("createFindingFingerprint is stable for same finding", () => {
  const finding = {
    ruleId: "a",
    serviceId: "web",
    filePath: "apps/web/index.ts",
    line: 1,
    severity: "error",
    importedPackage: "pg"
  };

  const a = createFindingFingerprint(finding);
  const b = createFindingFingerprint({ ...finding });
  assert.equal(a, b);
});

test("baseline document create/load/split works", () => {
  const findings = [
    { ruleId: "r1", serviceId: "web", filePath: "a.ts", line: 1, severity: "error", detail: "x" },
    { ruleId: "r2", serviceId: "api", filePath: "b.ts", line: 2, severity: "warn", detail: "y" }
  ];

  const doc = createBaselineDocument(findings);
  assert.equal(doc.entries.length, 2);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archguard-baseline-"));
  const baselinePath = path.join(tempDir, "baseline.json");
  fs.writeFileSync(baselinePath, JSON.stringify(doc), "utf8");

  const loaded = loadBaselineDocument(fs, baselinePath);
  const set = buildBaselineSet(loaded);
  const split = splitFindingsByBaseline(
    [...findings, { ruleId: "r3", serviceId: "api", filePath: "c.ts", line: 3, severity: "error", detail: "z" }],
    set
  );

  assert.equal(split.existing.length, 2);
  assert.equal(split.introduced.length, 1);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
