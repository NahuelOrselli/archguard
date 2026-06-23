#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const yaml = require("js-yaml");

const DB_CLIENT_PACKAGES = new Set([
  "@prisma/client",
  "pg",
  "mysql2",
  "mongodb"
]);

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const SUPPORTED_RULES = ["no_frontend_db_access", "require_owner"];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "init") {
    runInit(args);
    return;
  }

  if (args.command !== "check") {
    printUsageAndExit(1);
  }

  runCheck(args);
}

function runCheck(args) {
  const configPath = path.resolve(process.cwd(), args.config || ".arch.yaml");
  const config = loadConfig(configPath);
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
  findings.push(...validateRequireOwner(config, services));

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
        if (DB_CLIENT_PACKAGES.has(match.packageName)) {
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
    modelFilesChecked: [".arch.yaml"]
  });

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), report, "utf8");
  }

  process.stdout.write(report + "\n");

  if (findings.some((finding) => finding.severity === "error")) {
    process.exit(1);
  }
}

function runInit(args) {
  const configPath = path.resolve(process.cwd(), args.config || ".arch.yaml");
  if (fs.existsSync(configPath) && !args.force) {
    process.stderr.write(`Config already exists at ${configPath}. Use --force to overwrite.\n`);
    process.exit(1);
  }

  const discoveredServices = discoverServices();
  const config = {
    version: 0,
    services: discoveredServices,
    resources: [],
    rules: {
      no_frontend_db_access: "error",
      require_owner: "error"
    }
  };

  fs.writeFileSync(configPath, yaml.dump(config, { noRefs: true, lineWidth: 120 }), "utf8");
  process.stdout.write(`Created ${path.relative(process.cwd(), configPath) || ".arch.yaml"} with ${discoveredServices.length} services.\n`);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    config: ".arch.yaml",
    changedOnly: false,
    base: null,
    head: null,
    out: null,
    force: false
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
    }
  }

  return args;
}

function printUsageAndExit(code) {
  process.stderr.write(
    "Usage:\n" +
      "  archguard check --config .arch.yaml [--changed-only --base <sha> --head <sha>] [--out <file>]\n" +
      "  archguard init [--config .arch.yaml] [--force]\n"
  );
  process.exit(code);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const loaded = yaml.load(fs.readFileSync(configPath, "utf8"));
  if (!loaded || typeof loaded !== "object") {
    throw new Error("Invalid .arch.yaml content");
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
    output.push({ packageName: match[1], line: indexToLine(content, match.index) });
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

function validateRequireOwner(config, services) {
  const severity = getRuleSeverity(config, "require_owner");
  const findings = [];
  for (const service of services) {
    const owner = typeof service.owner === "string" ? service.owner.trim() : "";
    if (!owner) {
      findings.push({
        ruleId: "require_owner",
        severity,
        serviceId: service.id || "unknown",
        filePath: ".arch.yaml",
        reason: "services without an owner increase incident response and change risk.",
        fix: "set `owner` on every service in .arch.yaml."
      });
    }
  }
  return findings;
}

function validateFrontendPackageJson(config, service, servicePath, absolutePath, filePath) {
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
    if (DB_CLIENT_PACKAGES.has(depName)) {
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

function discoverServices() {
  const roots = ["apps", "services"];
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
      const lower = id.toLowerCase();
      const type = lower.includes("web") || lower.includes("front") || lower.includes("client") ? "frontend" : "backend";

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

function renderReport({ findings, changedOnly, changedFilesConsidered, codeFilesScanned, modelFilesChecked }) {
  const lines = [];
  lines.push("## Archguard Report");
  lines.push("");
  lines.push(`- Mode: ${changedOnly ? "changed-only" : "all-tracked-files"}`);
  lines.push(`- Changed files considered: ${changedFilesConsidered}`);
  lines.push(`- Code files scanned: ${codeFilesScanned}`);
  lines.push(`- Model files checked: ${modelFilesChecked.join(", ")}`);
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
    const detail = finding.importedPackage ? ` imported DB client \`${finding.importedPackage}\`` : "";
    lines.push(
      `- **${finding.severity.toUpperCase()}** ${finding.ruleId}: service \`${finding.serviceId}\`${detail} in \`${location}\`.`
    );
    lines.push(`  - Why this matters: ${finding.reason}`);
    lines.push(`  - How to fix: ${finding.fix}`);
  }

  return lines.join("\n");
}

main();
