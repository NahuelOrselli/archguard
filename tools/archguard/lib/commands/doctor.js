function runDoctor(args, ctx) {
  const {
    fs,
    path,
    process,
    DEFAULT_CONFIG_NAME,
    resolveExistingConfigPath,
    normalizePath,
    loadConfig,
    validateConfigShape,
    validateDetectors,
    validateRuleTemplates,
    validateServices,
    validateRules,
    renderDoctorReport
  } = ctx;

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

module.exports = {
  runDoctor
};
