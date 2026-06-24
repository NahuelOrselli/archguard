function runCheck(args, ctx) {
  const {
    fs,
    path,
    process,
    renderReport,
    splitFindingsByBaseline,
    loadBaselineDocument,
    buildBaselineSet
  } = ctx;

  const checkResult = collectCheckResult(args, ctx);
  let findingsForReport = checkResult.findings;
  let baselineInfo = null;

  if (args.baseline) {
    const baselinePath = path.resolve(process.cwd(), args.baseline);
    if (!fs.existsSync(baselinePath)) {
      throw new Error(`Baseline file not found: ${baselinePath}`);
    }

    const baselineDocument = loadBaselineDocument(fs, baselinePath);
    const baselineSet = buildBaselineSet(baselineDocument);
    const split = splitFindingsByBaseline(checkResult.findings, baselineSet);
    findingsForReport = split.introduced;
    baselineInfo = {
      path: args.baseline,
      total: checkResult.findings.length,
      existing: split.existing.length,
      introduced: split.introduced.length
    };
  }

  const report = renderReport({
    findings: findingsForReport,
    changedOnly: checkResult.changedOnly,
    changedFilesConsidered: checkResult.changedFilesConsidered,
    codeFilesScanned: checkResult.codeFilesScanned,
    modelFilesChecked: checkResult.modelFilesChecked,
    dbClientPackagesCount: checkResult.dbClientPackagesCount,
    enabledTemplateIds: checkResult.enabledTemplateIds,
    baselineInfo
  });

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), report, "utf8");
  }

  process.stdout.write(report + "\n");

  if (findingsForReport.some((finding) => finding.severity === "error")) {
    process.exit(1);
  }
}

function collectCheckResult(args, ctx) {
  const {
    fs,
    path,
    CODE_EXTENSIONS,
    DEFAULT_CONFIG_NAME,
    resolveExistingConfigPath,
    normalizePath,
    loadConfig,
    resolveDbClientPackages,
    getEnabledRuleTemplateIds,
    getChangedFiles,
    getTrackedFiles,
    validateRequireOwner,
    evaluateRuleTemplates,
    isInsidePath,
    validateFrontendPackageJson,
    extractImportsWithLine,
    getRuleSeverity
  } = ctx;

  const configPath = resolveExistingConfigPath(args.config);
  const configDisplayPath = normalizePath(path.relative(process.cwd(), configPath)) || DEFAULT_CONFIG_NAME;
  const config = loadConfig(configPath);
  const dbClientPackages = resolveDbClientPackages(config);
  const enabledTemplateIds = getEnabledRuleTemplateIds(config);
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

  return {
    findings,
    changedOnly: args.changedOnly,
    changedFilesConsidered: normalizedSourceFiles.length,
    codeFilesScanned: filesToScan.length,
    modelFilesChecked: [configDisplayPath],
    dbClientPackagesCount: dbClientPackages.size,
    enabledTemplateIds
  };
}

module.exports = {
  runCheck,
  collectCheckResult
};
