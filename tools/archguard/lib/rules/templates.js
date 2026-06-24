function evaluateRuleTemplates(config, services, filesToScan, options) {
  const {
    fs,
    path,
    codeExtensions,
    cwd,
    normalizePath,
    isInsidePath,
    extractImportsWithLine
  } = options;

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
      if (!codeExtensions.has(ext)) {
        continue;
      }

      if (!wildcardMatch(fromPattern, filePath, normalizePath)) {
        continue;
      }

      const absolutePath = path.resolve(cwd, filePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      const imports = extractImportsWithLine(fs.readFileSync(absolutePath, "utf8"));
      for (const imported of imports) {
        const targetPath = resolveImportTarget(filePath, imported.importPath, {
          path,
          cwd,
          normalizePath,
          codeExtensions,
          fs
        });
        if (!wildcardMatch(denyPattern, targetPath, normalizePath)) {
          continue;
        }

        findings.push({
          ruleId: template.id || "no_path_imports",
          severity,
          serviceId: detectServiceIdByFilePath(services, filePath, normalizePath, isInsidePath),
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

function resolveImportTarget(sourceFilePath, importPath, options) {
  const { path, cwd, normalizePath, codeExtensions, fs } = options;
  const normalizedImport = normalizePath(importPath);
  if (!normalizedImport.startsWith(".")) {
    return normalizedImport;
  }

  const sourceDir = path.dirname(path.resolve(cwd, sourceFilePath));
  const absoluteTarget = path.resolve(sourceDir, normalizedImport);
  const resolved = resolveCodePath(absoluteTarget, { fs, path, codeExtensions });
  return normalizePath(path.relative(cwd, resolved));
}

function resolveCodePath(absoluteBasePath, options) {
  const { fs, path, codeExtensions } = options;
  const candidates = [absoluteBasePath];
  for (const ext of codeExtensions) {
    candidates.push(`${absoluteBasePath}${ext}`);
  }

  for (const ext of codeExtensions) {
    candidates.push(path.join(absoluteBasePath, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return absoluteBasePath;
}

function wildcardMatch(pattern, value, normalizePath) {
  const regex = wildcardToRegExp(pattern, normalizePath);
  return regex.test(value);
}

function wildcardToRegExp(pattern, normalizePath) {
  const escaped = normalizePath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function detectServiceIdByFilePath(services, filePath, normalizePath, isInsidePath) {
  for (const service of services) {
    const servicePath = normalizePath(service.path || "");
    if (servicePath && isInsidePath(filePath, servicePath)) {
      return service.id || "unknown";
    }
  }
  return "unknown";
}

function getEnabledRuleTemplateIds(config) {
  const templates = Array.isArray(config.rule_templates) ? config.rule_templates : [];
  const ids = [];

  for (const template of templates) {
    if (!template || typeof template !== "object") {
      continue;
    }

    if (template.enabled === false) {
      continue;
    }

    const templateId = typeof template.id === "string" ? template.id.trim() : "";
    if (!templateId) {
      continue;
    }

    ids.push(templateId);
  }

  return ids;
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

module.exports = {
  evaluateRuleTemplates,
  getEnabledRuleTemplateIds,
  validateRuleTemplates
};
