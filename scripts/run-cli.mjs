import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();

runQuiet(process.execPath, [join(root, "scripts", "clean-dist.mjs")]);
runQuiet(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc")]);
runQuiet(process.execPath, [join(root, "scripts", "copy-assets.mjs")]);

const require = createRequire(import.meta.url);
const { runCli } = require(join(root, "dist", "src", "platform", "cli", "main.js"));
process.exitCode = await runCli(process.argv.slice(2));

function runQuiet(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status === 0) return;
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
