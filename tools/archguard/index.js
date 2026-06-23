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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "check") {
    printUsageAndExit(1);
  }

  const configPath = path.resolve(process.cwd(), args.config || ".arch.yaml");
  const config = loadConfig(configPath);
  const services = Array.isArray(config.services) ? config.services : [];
  const frontendServices = services.filter((service) => service.type === "frontend");

  const sourceFiles = args.changedOnly
    ? getChangedFiles(args.base, args.head)
    : getTrackedFiles();

  const filesToScan = sourceFiles.filter((filePath) => {
    const ext = path.extname(filePath);
    return CODE_EXTENSIONS.has(ext);
  });

  const findings = [];
  for (const service of frontendServices) {
    const servicePath = normalizePath(service.path || "");
    if (!servicePath) {
      continue;
    }

    for (const filePath of filesToScan) {
      const normalizedFilePath = normalizePath(filePath);
      if (!isInsidePath(normalizedFilePath, servicePath)) {
        continue;
      }

      const absolutePath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      const importedPackages = extractImports(fs.readFileSync(absolutePath, "utf8"));
      for (const importedPackage of importedPackages) {
        if (DB_CLIENT_PACKAGES.has(importedPackage)) {
          findings.push({
            ruleId: "no_frontend_db_access",
            severity: getRuleSeverity(config, "no_frontend_db_access"),
            serviceId: service.id || "unknown",
            servicePath,
            filePath: normalizedFilePath,
            importedPackage
          });
        }
      }
    }
  }

  const report = renderReport({ findings, filesScanned: filesToScan.length, changedOnly: args.changedOnly });

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), report, "utf8");
  }

  process.stdout.write(report + "\n");

  if (findings.some((finding) => finding.severity === "error")) {
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    config: ".arch.yaml",
    changedOnly: false,
    base: null,
    head: null,
    out: null
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
    }
  }

  return args;
}

function printUsageAndExit(code) {
  process.stderr.write(
    "Usage: archguard check --config .arch.yaml [--changed-only --base <sha> --head <sha>] [--out <file>]\n"
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

function extractImports(content) {
  const imports = [];
  const fromPattern = /from\s+["']([^"']+)["']/g;
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  collectMatches(fromPattern, content, imports);
  collectMatches(requirePattern, content, imports);
  collectMatches(dynamicImportPattern, content, imports);

  return imports;
}

function collectMatches(pattern, content, output) {
  let match = pattern.exec(content);
  while (match) {
    output.push(match[1]);
    match = pattern.exec(content);
  }
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

function renderReport({ findings, filesScanned, changedOnly }) {
  const lines = [];
  lines.push("## Archguard Report");
  lines.push("");
  lines.push(`- Mode: ${changedOnly ? "changed-only" : "all-tracked-files"}`);
  lines.push(`- Files scanned: ${filesScanned}`);
  lines.push(`- Rule: no_frontend_db_access`);
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
    lines.push(
      `- **${finding.severity.toUpperCase()}** ${finding.ruleId}: service \`${finding.serviceId}\` imported DB client \`${finding.importedPackage}\` in \`${finding.filePath}\`.`
    );
    lines.push("  - Why this matters: frontend-to-DB coupling bypasses the API boundary.");
    lines.push("  - How to fix: move DB access to a backend service and expose an API endpoint.");
  }

  return lines.join("\n");
}

main();
