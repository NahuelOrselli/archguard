const crypto = require("node:crypto");

const BASELINE_VERSION = 1;

function createFindingFingerprint(finding) {
  const stablePayload = {
    ruleId: finding.ruleId || "",
    serviceId: finding.serviceId || "",
    filePath: finding.filePath || "",
    line: finding.line || 0,
    detail: finding.detail || finding.importedPackage || "",
    severity: finding.severity || ""
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stablePayload))
    .digest("hex");
}

function createBaselineDocument(findings) {
  const entries = findings.map((finding) => {
    const detail = finding.detail || finding.importedPackage || "";
    return {
      fingerprint: createFindingFingerprint(finding),
      ruleId: finding.ruleId || "",
      serviceId: finding.serviceId || "",
      filePath: finding.filePath || "",
      line: finding.line || 0,
      severity: finding.severity || "",
      detail
    };
  });

  return {
    version: BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    total: entries.length,
    entries
  };
}

function loadBaselineDocument(fs, baselinePath) {
  const raw = fs.readFileSync(baselinePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid baseline format: ${baselinePath}`);
  }

  return parsed;
}

function buildBaselineSet(document) {
  return new Set(document.entries.map((entry) => entry.fingerprint).filter(Boolean));
}

function splitFindingsByBaseline(findings, baselineSet) {
  const existing = [];
  const introduced = [];

  for (const finding of findings) {
    const fingerprint = createFindingFingerprint(finding);
    if (baselineSet.has(fingerprint)) {
      existing.push(finding);
    } else {
      introduced.push(finding);
    }
  }

  return { existing, introduced };
}

module.exports = {
  BASELINE_VERSION,
  createFindingFingerprint,
  createBaselineDocument,
  loadBaselineDocument,
  buildBaselineSet,
  splitFindingsByBaseline
};
