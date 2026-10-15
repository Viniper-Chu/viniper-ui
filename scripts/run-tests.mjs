import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
// Python tempfile and Node os.tmpdir must follow the same repository residue
// boundary as tests that choose their own explicit temporary directories.
const temporaryRoot = join(process.cwd(), "codex", "运行残留", "test-tmp");
mkdirSync(temporaryRoot, { recursive: true });
env.TMPDIR = temporaryRoot;
env.TMP = temporaryRoot;
env.TEMP = temporaryRoot;
if (process.platform !== "win32") {
  const python = [
    env.VINIPER_PYTHON_PATH,
    join(process.cwd(), "codex", "运行残留", "test-venv", "bin", "python3"),
    join(homedir(), "Library", "Application Support", "Viniper workstation", "runtime", "python", "bin", "python3"),
  ].find((candidate) => candidate && existsSync(candidate));
  if (python) env.PATH = `${dirname(python)}:${env.PATH || ""}`;
}
function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith(".test.js") ? [path] : [];
  });
}
const files = testFiles("dist/tests").sort();
if (!files.length) throw new Error("No compiled tests found. Run npm run build first.");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...files, "resources/viniper-ui/desktop/platform-runtime.test.js"], {
  env, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
