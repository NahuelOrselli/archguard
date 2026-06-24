const DEFAULT_DB_CLIENT_PACKAGES = [
  "@prisma/client",
  "pg",
  "mysql2",
  "mongodb"
];

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

module.exports = {
  DEFAULT_DB_CLIENT_PACKAGES,
  resolveDbClientPackages,
  validateDetectors
};
