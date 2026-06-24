const { collectCheckResult } = require("./check");

function runBaseline(args, ctx) {
  const { fs, path, process, createBaselineDocument } = ctx;

  if (args.subcommand !== "create") {
    throw new Error("Unsupported baseline command. Use: archguard baseline create [--out <file>].");
  }

  const outputPath = path.resolve(process.cwd(), args.out || ".archguard-baseline.json");
  const result = collectCheckResult(
    {
      ...args,
      changedOnly: false,
      out: null,
      baseline: null
    },
    ctx
  );

  const document = createBaselineDocument(result.findings);
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2) + "\n", "utf8");

  process.stdout.write(`Created baseline with ${document.entries.length} findings at ${path.relative(process.cwd(), outputPath)}\n`);
}

module.exports = {
  runBaseline
};
