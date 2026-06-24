#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { execSync } = require("node:child_process");
const yaml = require("js-yaml");
const { runCheck } = require("./commands/check");
const { runDoctor } = require("./commands/doctor");
const { runInit } = require("./commands/init");
const { runBaseline } = require("./commands/baseline");
const {
  resolveDbClientPackages,
  validateDetectors
} = require("./rules/detectors");
const {
  evaluateRuleTemplates,
  getEnabledRuleTemplateIds,
  validateRuleTemplates
} = require("./rules/templates");
const {
  createBaselineDocument,
  loadBaselineDocument,
  buildBaselineSet,
  splitFindingsByBaseline
} = require("./baseline");

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const SUPPORTED_RULES = ["no_frontend_db_access", "require_owner"];
const SUPPORTED_SERVICE_TYPES = new Set(["frontend", "backend", "worker"]);
const DEFAULT_CONFIG_NAME = ".archguard.yaml";
const CONFIG_CANDIDATES = [DEFAULT_CONFIG_NAME, ".archguard.yml", ".arch.yaml", ".arch.yml"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const commandContext = createCommandContext();

  if (args.command === "init") {
    await runInit(args, commandContext);
    return;
  }

  if (args.command === "doctor") {
    runDoctor(args, commandContext);
    return;
  }

  if (args.command === "baseline") {
    runBaseline(args, commandContext);
    return;
  }

  if (args.command !== "check") {
    printUsageAndExit(1);
  }

  runCheck(args, commandContext);
}

function createCommandContext() {
  return {
    fs,
    path,
    yaml,
    process,
    CODE_EXTENSIONS,
    SUPPORTED_RULES,
    DEFAULT_CONFIG_NAME,
    resolveExistingConfigPath,
    resolveInitConfigPath,
    loadConfig,
    normalizePath,
    getChangedFiles,
    getTrackedFiles,
    resolveDbClientPackages,
    getEnabledRuleTemplateIds,
    validateRequireOwner,
    evaluateRuleTemplates: (config, services, filesToScan) =>
      evaluateRuleTemplates(config, services, filesToScan, {
        fs,
        path,
        codeExtensions: CODE_EXTENSIONS,
        cwd: process.cwd(),
        normalizePath,
        isInsidePath,
        extractImportsWithLine
      }),
    isInsidePath,
    validateFrontendPackageJson,
    extractImportsWithLine,
    getRuleSeverity,
    renderReport,
    validateConfigShape,
    validateDetectors,
    validateRuleTemplates,
    validateServices,
    validateRules,
    renderDoctorReport,
    createBaselineDocument,
    loadBaselineDocument,
    buildBaselineSet,
    splitFindingsByBaseline,
    resolveInitOptions,
    discoverServices,
    getRulesPreset
  };
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    config: null,
    changedOnly: false,
    base: null,
    head: null,
    out: null,
    baseline: null,
    force: false,
    yes: false,
    preset: null,
    root: null,
    subcommand: null
  };

  let startIndex = 1;
  if (args.command === "baseline") {
    args.subcommand = argv[1] || null;
    startIndex = 2;
  }

  for (let i = startIndex; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config") {
      args.config = argv[i + 1];
      i += 1;
    } else if (token === "--changed-only") {
      args.changedOnly = true;
    } else if (token === "--base") {
      args.base = argv[i + 1];
      i += 1;
    } else if (token === "--head") {
      args.head = argv[i + 1];
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1];
      i += 1;
    } else if (token === "--baseline") {
      args.baseline = argv[i + 1];
      i += 1;
    } else if (token === "--force") {
      args.force = true;
    } else if (token === "--yes") {
      args.yes = true;
    } else if (token === "--preset") {
      args.preset = argv[i + 1];
      i += 1;
    } else if (token === "--root") {
      args.root = argv[i + 1];
      i += 1;
    }
  }

  if (args.command === "init") {
    if (args.preset && !["minimal", "recommended", "strict"].includes(args.preset)) {
      process.stderr.write("Invalid --preset value. Use one of: minimal, recommended, strict.\n");
      process.exit(1);
    }
  }

  if (args.command === "baseline") {
    if (!args.subcommand) {
      process.stderr.write("Missing baseline subcommand. Use: baseline create\n");
      process.exit(1);
    }
    if (!["create"].includes(args.subcommand)) {
      process.stderr.write("Invalid baseline subcommand. Use: baseline create\n");
      process.exit(1);
    }
  }

  return args;
}

function printUsageAndExit(code) {
  process.stderr.write(
      "Usage:\n" +
      "  archguard check [--config .archguard.yaml] [--changed-only --base <sha> --head <sha>] [--baseline <file>] [--out <file>]\n" +
      "  archguard init [--config .archguard.yaml] [--force] [--yes] [--preset <minimal|recommended|strict>] [--root <path1,path2>]\n" +
      "  archguard doctor [--config .archguard.yaml] [--out <file>]\n" +
      "  archguard baseline create [--config .archguard.yaml] [--out .archguard-baseline.json]\n"
  );
  process.exit(code);
}

function resolveExistingConfigPath(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of CONFIG_CANDIDATES) {
    const candidatePath = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Config file not found. Expected one of: ${CONFIG_CANDIDATES.join(", ")}. You can also pass --config <path>.`
  );
}

function resolveInitConfigPath(explicitPath) {
  if (explicitPath) {
    return path.resolve(process.cwd(), explicitPath);
  }
  return path.resolve(process.cwd(), DEFAULT_CONFIG_NAME);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const loaded = yaml.load(fs.readFileSync(configPath, "utf8"));
  if (!loaded || typeof loaded !== "object") {
    throw new Error(`Invalid architecture config content: ${configPath}`);
  }

  return loaded;
}

function getTrackedFiles() {
  try {
    const output = execSync("git ls-files 2>/dev/null", { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return walkFiles(process.cwd()).map((absolutePath) =>
      normalizePath(path.relative(process.cwd(), absolutePath))
    );
  }
}

function getChangedFiles(base, head) {
  try {
    const diffTarget = base && head ? `${base}...${head}` : "HEAD~1...HEAD";
    const output = execSync(`git diff --name-only ${diffTarget} 2>/dev/null`, { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return getTrackedFiles();
  }
}

function walkFiles(rootDir) {
  const stack = [rootDir];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

function extractImportsWithLine(content) {
  const imports = [];
  const fromPattern = /from\s+["']([^"']+)["']/g;
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  collectMatchesWithLine(fromPattern, content, imports);
  collectMatchesWithLine(requirePattern, content, imports);
  collectMatchesWithLine(dynamicImportPattern, content, imports);

  return imports;
}

function collectMatchesWithLine(pattern, content, output) {
  let match = pattern.exec(content);
  while (match) {
    output.push({ packageName: match[1], importPath: match[1], line: indexToLine(content, match.index) });
    match = pattern.exec(content);
  }
}

function indexToLine(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function getRuleSeverity(config, ruleId) {
  const rules = config.rules && typeof config.rules === "object" ? config.rules : {};
  const rawSeverity = rules[ruleId];
  if (rawSeverity === "warn") {
    return "warn";
  }
  return "error";
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isInsidePath(filePath, parentPath) {
  return filePath === parentPath || filePath.startsWith(`${parentPath}/`);
}

function validateRequireOwner(config, services, configDisplayPath) {
  const severity = getRuleSeverity(config, "require_owner");
  const findings = [];
  for (const service of services) {
    const owner = typeof service.owner === "string" ? service.owner.trim() : "";
    if (!owner) {
      findings.push({
        ruleId: "require_owner",
        severity,
        serviceId: service.id || "unknown",
        filePath: configDisplayPath,
        reason: "services without an owner increase incident response and change risk.",
        fix: `set \`owner\` on every service in ${configDisplayPath}.`
      });
    }
  }
  return findings;
}

function validateFrontendPackageJson(config, service, servicePath, absolutePath, filePath) {
  const dbClientPackages = resolveDbClientPackages(config);
  const findings = [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch {
    return findings;
  }

  const deps = {
    ...(parsed.dependencies || {}),
    ...(parsed.devDependencies || {}),
    ...(parsed.optionalDependencies || {})
  };

  for (const depName of Object.keys(deps)) {
    if (dbClientPackages.has(depName)) {
      findings.push({
        ruleId: "no_frontend_db_access",
        severity: getRuleSeverity(config, "no_frontend_db_access"),
        serviceId: service.id || "unknown",
        servicePath,
        filePath,
        importedPackage: depName,
        reason: "frontend package depends on a DB client, which usually indicates direct DB access.",
        fix: "remove DB client dependency from frontend and keep data access in backend services."
      });
    }
  }

  return findings;
}

function discoverServices(roots, inferenceMode) {
  const discovered = [];

  for (const root of roots) {
    const absoluteRoot = path.resolve(process.cwd(), root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      continue;
    }

    const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const id = entry.name;
      const type = inferServiceType(id, inferenceMode);

      discovered.push({
        id,
        path: normalizePath(path.join(root, id)),
        type,
        owner: "TODO"
      });
    }
  }

  if (discovered.length === 0) {
    return [
      {
        id: "app",
        path: "apps/app",
        type: "backend",
        owner: "TODO"
      }
    ];
  }

  return discovered;
}

function inferServiceType(serviceId, inferenceMode) {
  if (inferenceMode === "backend") {
    return "backend";
  }

  const lower = serviceId.toLowerCase();
  if (lower.includes("web") || lower.includes("front") || lower.includes("client") || lower.includes("ui")) {
    return "frontend";
  }
  return "backend";
}

function getRulesPreset(preset) {
  if (preset === "minimal") {
    return {
      require_owner: "error",
      no_frontend_db_access: "warn"
    };
  }

  return {
    no_frontend_db_access: "error",
    require_owner: "error"
  };
}

function getDefaultInitOptions() {
  const defaults = detectDefaultRoots();
  return {
    roots: defaults,
    inferenceMode: "auto",
    preset: "recommended"
  };
}

async function resolveInitOptions(args) {
  const defaults = getDefaultInitOptions();
  const flagRoots = args.root ? parseRootsAnswer(args.root, defaults.roots) : null;

  if (args.yes || !process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      roots: flagRoots || defaults.roots,
      inferenceMode: "auto",
      preset: args.preset || "recommended"
    };
  }

  const interactive = await askInitOptions({
    roots: flagRoots || defaults.roots,
    preset: args.preset || "recommended"
  });

  return {
    roots: interactive.roots,
    inferenceMode: interactive.inferenceMode,
    preset: interactive.preset
  };
}

function detectDefaultRoots() {
  const candidates = ["apps", "services", "src"];
  const existing = candidates.filter((candidate) => {
    const absolutePath = path.resolve(process.cwd(), candidate);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
  });

  if (existing.length > 0) {
    return existing;
  }

  return ["apps", "services"];
}

async function askInitOptions(defaults) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const rootsAnswer = await rl.question(
      `Service roots (comma-separated) [${defaults.roots.join(",")}]: `
    );
    const roots = parseRootsAnswer(rootsAnswer, defaults.roots);

    const inferenceAnswer = await rl.question(
      "Service type inference mode [auto/backend] (default: auto): "
    );
    const inferenceMode = normalizeChoice(inferenceAnswer, ["auto", "backend"], "auto");

    const presetAnswer = await rl.question(
      `Rules preset [minimal/recommended/strict] (default: ${defaults.preset}): `
    );
    const preset = normalizeChoice(presetAnswer, ["minimal", "recommended", "strict"], defaults.preset);

    return { roots, inferenceMode, preset };
  } finally {
    rl.close();
  }
}

function parseRootsAnswer(answer, fallbackRoots) {
  if (!answer || !answer.trim()) {
    return fallbackRoots;
  }

  const roots = answer
    .split(",")
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);

  if (roots.length === 0) {
    return fallbackRoots;
  }

  return roots;
}

function normalizeChoice(answer, validChoices, fallback) {
  if (!answer || !answer.trim()) {
    return fallback;
  }

  const normalized = answer.trim().toLowerCase();
  if (validChoices.includes(normalized)) {
    return normalized;
  }

  return fallback;
}

function validateConfigShape(config, configDisplayPath, diagnostics) {
  const hasValidVersion = typeof config.version === "number";
  if (!hasValidVersion) {
    diagnostics.push({
      level: "warn",
      code: "config_missing_version",
      location: configDisplayPath,
      message: "`version` should be a number.",
      fix: "set `version: 0` at the top level."
    });
  }

  if (!Array.isArray(config.services)) {
    diagnostics.push({
      level: "error",
      code: "config_invalid_services",
      location: configDisplayPath,
      message: "`services` must be an array.",
      fix: "define `services` as a list of service objects."
    });
  }

  if (config.rules && typeof config.rules !== "object") {
    diagnostics.push({
      level: "error",
      code: "config_invalid_rules",
      location: configDisplayPath,
      message: "`rules` must be an object map.",
      fix: "set `rules` with key-value pairs, e.g. `rule_id: error`."
    });
  }
}

function validateServices(config, configDisplayPath, diagnostics) {
  if (!Array.isArray(config.services)) {
    return;
  }

  if (config.services.length === 0) {
    diagnostics.push({
      level: "warn",
      code: "services_empty",
      location: configDisplayPath,
      message: "No services declared.",
      fix: "add at least one service entry in `services`."
    });
  }

  const seenIds = new Map();
  const seenPaths = new Map();

  for (const service of config.services) {
    const serviceId = typeof service.id === "string" ? service.id.trim() : "";
    const servicePath = typeof service.path === "string" ? normalizePath(service.path.trim()) : "";
    const serviceType = typeof service.type === "string" ? service.type.trim() : "";

    if (!serviceId) {
      diagnostics.push({
        level: "error",
        code: "service_missing_id",
        location: configDisplayPath,
        message: "A service is missing `id`.",
        fix: "set a unique `id` for every service."
      });
    }

    if (!servicePath) {
      diagnostics.push({
        level: "error",
        code: "service_missing_path",
        location: configDisplayPath,
        message: `Service ${formatServiceLabel(serviceId)} is missing \`path\`.`,
        fix: "set a valid relative path for each service."
      });
    } else {
      const absolutePath = path.resolve(process.cwd(), servicePath);
      if (!fs.existsSync(absolutePath)) {
        diagnostics.push({
          level: "warn",
          code: "service_path_missing",
          location: configDisplayPath,
          message: `Service ${formatServiceLabel(serviceId)} path does not exist: ${servicePath}`,
          fix: "update the service path or create the directory."
        });
      }
    }

    if (!SUPPORTED_SERVICE_TYPES.has(serviceType)) {
      diagnostics.push({
        level: "warn",
        code: "service_unknown_type",
        location: configDisplayPath,
        message: `Service ${formatServiceLabel(serviceId)} has unsupported type: ${serviceType || "<empty>"}.`,
        fix: "use one of: frontend, backend, worker."
      });
    }

    if (serviceId) {
      const previous = seenIds.get(serviceId);
      if (previous) {
        diagnostics.push({
          level: "error",
          code: "service_duplicate_id",
          location: configDisplayPath,
          message: `Duplicate service id: ${serviceId}.`,
          fix: "ensure each service id is unique."
        });
      }
      seenIds.set(serviceId, true);
    }

    if (servicePath) {
      const previous = seenPaths.get(servicePath);
      if (previous) {
        diagnostics.push({
          level: "warn",
          code: "service_duplicate_path",
          location: configDisplayPath,
          message: `Multiple services share the same path: ${servicePath}.`,
          fix: "assign distinct paths or collapse into one service."
        });
      }
      seenPaths.set(servicePath, true);
    }
  }
}

function validateRules(config, configDisplayPath, diagnostics) {
  if (!config.rules || typeof config.rules !== "object") {
    return;
  }

  for (const [ruleId, value] of Object.entries(config.rules)) {
    if (!SUPPORTED_RULES.includes(ruleId)) {
      diagnostics.push({
        level: "warn",
        code: "rule_unknown",
        location: configDisplayPath,
        message: `Unknown rule id: ${ruleId}.`,
        fix: `use supported rules: ${SUPPORTED_RULES.join(", ")}.`
      });
    }

    if (!["off", "warn", "error"].includes(value)) {
      diagnostics.push({
        level: "error",
        code: "rule_invalid_severity",
        location: configDisplayPath,
        message: `Invalid severity for ${ruleId}: ${String(value)}.`,
        fix: "use one of: off, warn, error."
      });
    }
  }
}

function formatServiceLabel(serviceId) {
  if (serviceId) {
    return `\`${serviceId}\``;
  }
  return "<unknown>";
}

function renderDoctorReport({ diagnostics, configDisplayPath }) {
  const lines = [];
  const errors = diagnostics.filter((entry) => entry.level === "error");
  const warnings = diagnostics.filter((entry) => entry.level === "warn");

  lines.push("## Archguard Doctor Report");
  lines.push("");
  lines.push(`- Config: ${configDisplayPath}`);
  lines.push(`- Errors: ${errors.length}`);
  lines.push(`- Warnings: ${warnings.length}`);
  lines.push("");

  if (diagnostics.length === 0) {
    lines.push("### Result");
    lines.push("");
    lines.push("No config issues found.");
    return lines.join("\n");
  }

  lines.push("### Findings");
  lines.push("");

  for (const entry of diagnostics) {
    lines.push(`- **${entry.level.toUpperCase()}** ${entry.code} in \`${entry.location}\`: ${entry.message}`);
    lines.push(`  - How to fix: ${entry.fix}`);
  }

  return lines.join("\n");
}

function renderReport({
  findings,
  changedOnly,
  changedFilesConsidered,
  codeFilesScanned,
  modelFilesChecked,
  dbClientPackagesCount,
  enabledTemplateIds,
  baselineInfo
}) {
  const lines = [];
  lines.push("## Archguard Report");
  lines.push("");
  lines.push(`- Mode: ${changedOnly ? "changed-only" : "all-tracked-files"}`);
  lines.push(`- Changed files considered: ${changedFilesConsidered}`);
  lines.push(`- Code files scanned: ${codeFilesScanned}`);
  lines.push(`- Model files checked: ${modelFilesChecked.join(", ")}`);
  lines.push(`- DB client detector packages: ${dbClientPackagesCount}`);
  lines.push(`- Built-in rules: ${SUPPORTED_RULES.join(", ")}`);
  lines.push(
    `- Rule templates: ${enabledTemplateIds.length > 0 ? enabledTemplateIds.join(", ") : "none"}`
  );
  if (baselineInfo) {
    lines.push(`- Baseline: ${baselineInfo.path}`);
    lines.push(
      `- Baseline filtering: ${baselineInfo.existing} existing ignored, ${baselineInfo.introduced} introduced`
    );
  }
  lines.push(`- Violations: ${findings.length}`);
  lines.push("");

  if (findings.length === 0) {
    lines.push("### Result");
    lines.push("");
    lines.push("No architecture violations found.");
    return lines.join("\n");
  }

  lines.push("### Violations");
  lines.push("");

  for (const finding of findings) {
    const location = finding.line ? `${finding.filePath}:${finding.line}` : finding.filePath;
    const detail = finding.detail || (finding.importedPackage ? ` imported DB client \`${finding.importedPackage}\`` : "");
    lines.push(
      `- **${finding.severity.toUpperCase()}** ${finding.ruleId}: service \`${finding.serviceId}\`${detail} in \`${location}\`.`
    );
    lines.push(`  - Why this matters: ${finding.reason}`);
    lines.push(`  - How to fix: ${finding.fix}`);
  }

  return lines.join("\n");
}

module.exports = {
  main
};
