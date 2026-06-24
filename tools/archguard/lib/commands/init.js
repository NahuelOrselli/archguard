async function runInit(args, ctx) {
  const {
    fs,
    path,
    yaml,
    process,
    DEFAULT_CONFIG_NAME,
    resolveInitConfigPath,
    normalizePath,
    resolveInitOptions,
    discoverServices,
    getRulesPreset
  } = ctx;

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

module.exports = {
  runInit
};
