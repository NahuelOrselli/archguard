const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveDbClientPackages,
  validateDetectors
} = require("../tools/archguard/lib/rules/detectors");

test("resolveDbClientPackages extends defaults", () => {
  const packages = resolveDbClientPackages({
    detectors: {
      db_client_packages_mode: "extend",
      db_client_packages: ["knex"]
    }
  });

  assert.equal(packages.has("pg"), true);
  assert.equal(packages.has("knex"), true);
});

test("resolveDbClientPackages can replace defaults", () => {
  const packages = resolveDbClientPackages({
    detectors: {
      db_client_packages_mode: "replace",
      db_client_packages: ["drizzle-orm"]
    }
  });

  assert.equal(packages.has("pg"), false);
  assert.equal(packages.has("drizzle-orm"), true);
});

test("validateDetectors reports invalid detector shape", () => {
  const diagnostics = [];
  validateDetectors({ detectors: "bad" }, ".archguard.yaml", diagnostics);

  assert.equal(diagnostics.length > 0, true);
  assert.equal(diagnostics[0].code, "detectors_invalid_shape");
});
