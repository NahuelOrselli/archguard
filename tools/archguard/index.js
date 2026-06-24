#!/usr/bin/env node

const { main } = require("./lib/cli");

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
