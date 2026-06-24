#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { execSync } = require("node:child_process");
const yaml = require("js-yaml");

const DEFAULT_DB_CLIENT_PACKAGES = [
  "@prisma/client",
  "pg",
  "mysql2",
  "mongodb"
];

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const SUPPORTED_RULES = ["no_frontend_db_access", "require_owner"];
const SUPPORTED_SERVICE_TYPES = new Set(["frontend", "backend", "worker"]);
const DEFAULT_CONFIG_NAME = ".archguard.yaml";
const CONFIG_CANDIDATES = [DEFAULT_CONFIG_NAME, ".archguard.yml", ".arch.yaml", ".arch.yml"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "init") {
    await runInit(args);
    return;
  }

  if (args.command === "doctor") {
    runDoctor(args);
    return;
  }

  if (args.command !== "check") {
    printUsageAndExit(1);
  }

  runCheck(args);
}

function runCheck(args) {
  const configPath = resolveExistingConfigPath(args.config);
  const configDisplayPath = normalizePath(path.relative(process.cwd(), configPath)) || DEFAULT_CONFIG_NAME;
  const config = loadConfig(configPath);
  const dbClientPackages = resolveDbClientPackages(config);
  const services = Array.isArray(config.services) ? config.services : [];
  const frontendServices = services.filter((service) => service.type === "frontend");

  const sourceFiles = args.changedOnly
    ? getChangedFiles(args.base, args.head)
    : getTrackedFiles();

  const normalizedSourceFiles = sourceFiles.map(normalizePath);

  const filesToScan = normalizedSourceFiles.filter((filePath) => {
    const ext = path.extname(filePath);
    return CODE_EXTENSIONS.has(ext) || path.basename(filePath) === "package.json";
  });

  const findings = [];
  findings.push(...validateRequireOwner(config, services, configDisplayPath));
  findings.push(...evaluateRuleTemplates(config, services, filesToScan));

  for (const service of frontendServices) {
    const servicePath = normalizePath(service.path || "");
    if (!servicePath) {
      continue;
    }

    for (const filePath of filesToScan) {
      if (!isInsidePath(filePath, servicePath)) {
        continue;
      }

      const absolutePath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      if (path.basename(filePath) === "package.json") {
        findings.push(...validateFrontendPackageJson(config, service, servicePath, absolutePath, filePath));
        continue;
      }

      const importMatches = extractImportsWithLine(fs.readFileSync(absolutePath, "utf8"));
      for (const match of importMatches) {
        if (dbClientPackages.has(match.packageName)) {
          findings.push({
            ruleId: "no_frontend_db_access",
            severity: getRuleSeverity(config, "no_frontend_db_access"),
            serviceId: service.id || "unknown",
            servicePath,
            filePath,
            line: match.line,
            importedPackage: match.packageName,
            reason: "frontend-to-DB coupling bypasses the API boundary.",
            fix: "move DB access to a backend service and expose an API endpoint."
          });
        }
      }
    }
  }

  const report = renderReport({
    findings,
    changedOnly: args.changedOnly,
    changedFilesConsidered: normalizedSourceFiles.length,
    codeFilesScanned: filesToScan.length,
    modelFilesChecked: [configDisplayPath],
    dbClientPackagesCount: dbClientPackages.size
  });

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), report, "utf8");
  }

  process.stdout.write(report + "\n");

  if (findings.some((finding) => finding.severity === "error")) {
    process.exit(1);
  }
}

function runDoctor(args) {
  const configPath = resolveExistingConfigPath(args.config);
  const configDisplayPath = normalizePath(path.relative(process.cwd(), configPath)) || DEFAULT_CONFIG_NAME;
  const config = loadConfig(configPath);

  const diagnostics = [];
  validateConfigShape(config, configDisplayPath, diagnostics);
  validateDetectors(config, configDisplayPath, diagnostics);
  validateRuleTemplates(config, configDisplayPath, diagnostics);
  validateServices(config, configDisplayPath, diagnostics);
  validateRules(config, configDisplayPath, diagnostics);

  const report = renderDoctorReport({ diagnostics, configDisplayPath });

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), report, "utf8");
  }

  process.stdout.write(report + "\n");

  if (diagnostics.some((entry) => entry.level === "error")) {
    process.exit(1);
  }
}

async function runInit(args) {
  const configPath = resolveInitConfigPath(args.config);
  const configDisplayPath = normalizePath(path.relative(process.cwd(), configPath)) || DEFAULT_CONFIG_NAME;
  if (fs.existsSync(configPath) && !args.force) {
    process.stderr.write(`Config already exists at ${configPath}. Use --force to overwrite.\n`);
    process.exit(1);
  }

  const initOptions = await resolveInitOptions(args);
  const discoveredServices = discoverServices(initOptions.roots, initOptions.inferenceMode);
  const config = {
    version: 0,
    services: discoveredServices,
    resources: [],
    rules: getRulesPreset(initOptions.preset)
  };

  fs.writeFileSync(configPath, yaml.dump(config, { noRefs: true, lineWidth: 120 }), "utf8");
  process.stdout.write(`Created ${configDisplayPath} with ${discoveredServices.length} services.\n`);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    config: null,
    changedOnly: false,
    base: null,
    head: null,
    out: null,
    force: false,
    yes: false,
    preset: null,
    root: null
  };

  for (let i = 1; i < argv.length; i += 1) {
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

  return args;
}

function printUsageAndExit(code) {
  process.stderr.write(
    "Usage:\n" +
      "  archguard check [--config .archguard.yaml] [--changed-only --base <sha> --head <sha>] [--out <file>]\n" +
      "  archguard init [--config .archguard.yaml] [--force] [--yes] [--preset <minimal|recommended|strict>] [--root <path1,path2>]\n" +
      "  archguard doctor [--config .archguard.yaml] [--out <file>]\n"
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

function resolveDbClientPackages(config) {
  const defaults = new Set(DEFAULT_DB_CLIENT_PACKAGES);
  const detectors = config.detectors && typeof config.detectors === "object" ? config.detectors : {};
  const mode = detectors.db_client_packages_mode === "replace" ? "replace" : "extend";
  const customPackages = Array.isArray(detectors.db_client_packages)
    ? detectors.db_client_packages
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  if (mode === "replace") {
    return new Set(customPackages);
  }

  for (const packageName of customPackages) {
    defaults.add(packageName);
  }

  return defaults;
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

function evaluateRuleTemplates(config, services, filesToScan) {
  const templates = Array.isArray(config.rule_templates) ? config.rule_templates : [];
  const findings = [];

  for (const template of templates) {
    if (!template || typeof template !== "object") {
      continue;
    }

    if (template.type !== "no_path_imports") {
      continue;
    }

    if (template.enabled === false) {
      continue;
    }

    const fromPattern = normalizePath(String(template.from || "").trim());
    const denyPattern = normalizePath(String(template.deny_import || "").trim());
    if (!fromPattern || !denyPattern) {
      continue;
    }

    const severity = ["off", "warn", "error"].includes(template.severity) ? template.severity : "error";
    if (severity === "off") {
      continue;
    }

    for (const filePath of filesToScan) {
      const ext = path.extname(filePath);
      if (!CODE_EXTENSIONS.has(ext)) {
        continue;
      }

      if (!wildcardMatch(fromPattern, filePath)) {
        continue;
      }

      const absolutePath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      const imports = extractImportsWithLine(fs.readFileSync(absolutePath, "utf8"));
      for (const imported of imports) {
        const targetPath = resolveImportTarget(filePath, imported.importPath);
        if (!wildcardMatch(denyPattern, targetPath)) {
          continue;
        }

        findings.push({
          ruleId: template.id || "no_path_imports",
          severity,
          serviceId: detectServiceIdByFilePath(services, filePath),
          filePath,
          line: imported.line,
          detail: ` imported path \`${imported.importPath}\``,
          reason: `imports from \`${filePath}\` match deny pattern \`${denyPattern}\`.`,
          fix: `update boundaries or change template \`${template.id || "no_path_imports"}\` patterns.`
        });
      }
    }
  }

  return findings;
}

function resolveImportTarget(sourceFilePath, importPath) {
  const normalizedImport = normalizePath(importPath);
  if (!normalizedImport.startsWith(".")) {
    return normalizedImport;
  }

  const sourceDir = path.dirname(path.resolve(process.cwd(), sourceFilePath));
  const absoluteTarget = path.resolve(sourceDir, normalizedImport);
  const resolved = resolveCodePath(absoluteTarget);
  return normalizePath(path.relative(process.cwd(), resolved));
}

function resolveCodePath(absoluteBasePath) {
  const candidates = [absoluteBasePath];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(`${absoluteBasePath}${ext}`);
  }

  for (const ext of CODE_EXTENSIONS) {
    candidates.push(path.join(absoluteBasePath, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return absoluteBasePath;
}

function wildcardMatch(pattern, value) {
  const regex = wildcardToRegExp(pattern);
  return regex.test(value);
}

function wildcardToRegExp(pattern) {
  const escaped = normalizePath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function detectServiceIdByFilePath(services, filePath) {
  for (const service of services) {
    const servicePath = normalizePath(service.path || "");
    if (servicePath && isInsidePath(filePath, servicePath)) {
      return service.id || "unknown";
    }
  }
  return "unknown";
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

function validateDetectors(config, configDisplayPath, diagnostics) {
  if (!config.detectors) {
    return;
  }

  if (typeof config.detectors !== "object" || Array.isArray(config.detectors)) {
    diagnostics.push({
      level: "error",
      code: "detectors_invalid_shape",
      location: configDisplayPath,
      message: "`detectors` must be an object.",
      fix: "set `detectors` as an object map."
    });
    return;
  }

  const mode = config.detectors.db_client_packages_mode;
  if (mode !== undefined && !["extend", "replace"].includes(mode)) {
    diagnostics.push({
      level: "error",
      code: "detectors_invalid_db_mode",
      location: configDisplayPath,
      message: `Invalid db client detector mode: ${String(mode)}.`,
      fix: "use `db_client_packages_mode: extend` or `replace`."
    });
  }

  const packages = config.detectors.db_client_packages;
  if (packages === undefined) {
    return;
  }

  if (!Array.isArray(packages)) {
    diagnostics.push({
      level: "error",
      code: "detectors_invalid_db_list",
      location: configDisplayPath,
      message: "`detectors.db_client_packages` must be an array.",
      fix: "set it as a list of package names."
    });
    return;
  }

  for (const value of packages) {
    if (typeof value !== "string" || !value.trim()) {
      diagnostics.push({
        level: "error",
        code: "detectors_invalid_db_item",
        location: configDisplayPath,
        message: "`detectors.db_client_packages` contains invalid values.",
        fix: "use non-empty string package names only."
      });
      break;
    }
  }
}

function validateRuleTemplates(config, configDisplayPath, diagnostics) {
  if (config.rule_templates === undefined) {
    return;
  }

  if (!Array.isArray(config.rule_templates)) {
    diagnostics.push({
      level: "error",
      code: "rule_templates_invalid_shape",
      location: configDisplayPath,
      message: "`rule_templates` must be an array.",
      fix: "set `rule_templates` as a list of template objects."
    });
    return;
  }

  const seenTemplateIds = new Set();

  for (const template of config.rule_templates) {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      diagnostics.push({
        level: "error",
        code: "rule_template_invalid_item",
        location: configDisplayPath,
        message: "`rule_templates` contains an invalid entry.",
        fix: "each template must be an object."
      });
      continue;
    }

    if (template.type !== "no_path_imports") {
      diagnostics.push({
        level: "warn",
        code: "rule_template_unknown_type",
        location: configDisplayPath,
        message: `Unknown template type: ${String(template.type)}.`,
        fix: "use `type: no_path_imports` for now."
      });
      continue;
    }

    if (typeof template.id !== "string" || !template.id.trim()) {
      diagnostics.push({
        level: "error",
        code: "rule_template_missing_id",
        location: configDisplayPath,
        message: "Template missing `id`.",
        fix: "set a unique template `id`."
      });
    } else if (seenTemplateIds.has(template.id.trim())) {
      diagnostics.push({
        level: "error",
        code: "rule_template_duplicate_id",
        location: configDisplayPath,
        message: `Duplicate template id: ${template.id.trim()}.`,
        fix: "use unique ids across `rule_templates`."
      });
    } else {
      seenTemplateIds.add(template.id.trim());
    }

    if (typeof template.from !== "string" || !template.from.trim()) {
      diagnostics.push({
        level: "error",
        code: "rule_template_missing_from",
        location: configDisplayPath,
        message: `Template ${String(template.id || "<unknown>")} is missing \`from\`.`,
        fix: "set a wildcard path pattern in `from`."
      });
    }

    if (typeof template.deny_import !== "string" || !template.deny_import.trim()) {
      diagnostics.push({
        level: "error",
        code: "rule_template_missing_deny_import",
        location: configDisplayPath,
        message: `Template ${String(template.id || "<unknown>")} is missing \`deny_import\`.`,
        fix: "set a wildcard path pattern in `deny_import`."
      });
    }

    if (template.severity !== undefined && !["off", "warn", "error"].includes(template.severity)) {
      diagnostics.push({
        level: "error",
        code: "rule_template_invalid_severity",
        location: configDisplayPath,
        message: `Template ${String(template.id || "<unknown>")} has invalid severity: ${String(template.severity)}.`,
        fix: "use one of: off, warn, error."
      });
    }
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

function renderReport({ findings, changedOnly, changedFilesConsidered, codeFilesScanned, modelFilesChecked, dbClientPackagesCount }) {
  const lines = [];
  lines.push("## Archguard Report");
  lines.push("");
  lines.push(`- Mode: ${changedOnly ? "changed-only" : "all-tracked-files"}`);
  lines.push(`- Changed files considered: ${changedFilesConsidered}`);
  lines.push(`- Code files scanned: ${codeFilesScanned}`);
  lines.push(`- Model files checked: ${modelFilesChecked.join(", ")}`);
  lines.push(`- DB client detector packages: ${dbClientPackagesCount}`);
  lines.push(`- Rules: ${SUPPORTED_RULES.join(", ")}`);
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

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
