const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  evaluateRuleTemplates,
  getEnabledRuleTemplateIds,
  validateRuleTemplates
} = require("../tools/archguard/lib/rules/templates");

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isInsidePath(filePath, parentPath) {
  return filePath === parentPath || filePath.startsWith(`${parentPath}/`);
}

function extractImportsWithLine(content) {
  const imports = [];
  const fromPattern = /from\s+["']([^"']+)["']/g;
  let match = fromPattern.exec(content);
  while (match) {
    imports.push({ importPath: match[1], packageName: match[1], line: 1 });
    match = fromPattern.exec(content);
  }
  return imports;
}

test("getEnabledRuleTemplateIds returns enabled ids", () => {
  const ids = getEnabledRuleTemplateIds({
    rule_templates: [
      { id: "a", type: "no_path_imports" },
      { id: "b", type: "no_path_imports", enabled: false }
    ]
  });

  assert.deepEqual(ids, ["a"]);
});

test("validateRuleTemplates reports missing fields", () => {
  const diagnostics = [];
  validateRuleTemplates(
    {
      rule_templates: [{ type: "no_path_imports" }]
    },
    ".archguard.yaml",
    diagnostics
  );

  const codes = diagnostics.map((entry) => entry.code);
  assert.equal(codes.includes("rule_template_missing_id"), true);
  assert.equal(codes.includes("rule_template_missing_from"), true);
  assert.equal(codes.includes("rule_template_missing_deny_import"), true);
});

test("evaluateRuleTemplates detects no_path_imports violations", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archguard-templates-"));
  const webDir = path.join(tempRoot, "apps", "web", "src");
  const apiDir = path.join(tempRoot, "apps", "api", "src");
  fs.mkdirSync(webDir, { recursive: true });
  fs.mkdirSync(apiDir, { recursive: true });

  const webFile = path.join(webDir, "index.ts");
  const apiFile = path.join(apiDir, "users.ts");
  fs.writeFileSync(webFile, 'import { users } from "../../api/src/users";\n', "utf8");
  fs.writeFileSync(apiFile, 'export const users = [];\n', "utf8");

  const previousCwd = process.cwd();
  process.chdir(tempRoot);

  try {
    const findings = evaluateRuleTemplates(
      {
        rule_templates: [
          {
            id: "no-web-imports-from-api",
            type: "no_path_imports",
            from: "apps/web/**",
            deny_import: "apps/api/**",
            severity: "error"
          }
        ]
      },
      [
        { id: "web", path: "apps/web", type: "frontend" },
        { id: "api", path: "apps/api", type: "backend" }
      ],
      ["apps/web/src/index.ts"],
      {
        fs,
        path,
        codeExtensions: CODE_EXTENSIONS,
        cwd: tempRoot,
        normalizePath,
        isInsidePath,
        extractImportsWithLine
      }
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "no-web-imports-from-api");
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
