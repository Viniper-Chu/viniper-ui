import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const helperCopy = { recursive: true, filter: (path) => !path.split(/[\\/]/u).includes("__pycache__") && !path.endsWith(".pyc") };
const terminalVendor = join(root, "resources", "viniper-ui", "static", "vendor");
mkdirSync(terminalVendor, { recursive: true });
for (const [source, target] of [
  ["markdown-it/dist/browser/markdown-it.umd.min.js", "markdown-it.js"],
  ["markdown-it/LICENSE", "markdown-it-LICENSE"],
]) cpSync(join(root, "node_modules", source), join(terminalVendor, target));
mkdirSync(join(terminalVendor, "katex"), { recursive: true });
for (const file of ["katex.min.js", "katex.min.css", "fonts"]) {
  cpSync(join(root, "node_modules", "katex", "dist", file), join(terminalVendor, "katex", file), { recursive: true });
}
cpSync(join(root, "node_modules", "katex", "LICENSE"), join(terminalVendor, "katex", "LICENSE"));
const destination = join(root, "dist", "src", "renderer");
mkdirSync(destination, { recursive: true });
cpSync(join(root, "src", "renderer"), destination, { recursive: true });

const desktopAssets = join(root, "dist", "src", "platform", "desktop");
mkdirSync(desktopAssets, { recursive: true });
cpSync(join(root, "skills"), join(desktopAssets, "skills"), { recursive: true });
cpSync(join(root, "plugins"), join(desktopAssets, "plugins"), { recursive: true });
cpSync(join(root, "agent-helpers"), join(desktopAssets, "agent-helpers"), helperCopy);

const brandingAssets = join(root, "assets", "branding");
cpSync(brandingAssets, join(root, "dist", "assets", "branding"), { recursive: true });

// Source checkout and packaged desktop must use the same compiled runtime.
// A clean clone has no tracked harness-runtime/dist directory.
rmSync(join(root, "resources", "viniper-ui", "harness-runtime"), { recursive: true, force: true });
cpSync(join(root, "dist", "src"), join(root, "resources", "viniper-ui", "harness-runtime", "dist", "src"), { recursive: true });
cpSync(join(root, "skills"), join(root, "resources", "viniper-ui", "harness-runtime", "skills"), { recursive: true });
cpSync(join(root, "agent-helpers"), join(root, "resources", "viniper-ui", "harness-runtime", "agent-helpers"), helperCopy);

cpSync(join(root, "plugins"), join(root, "resources", "viniper-ui", "harness-runtime", "plugins"), { recursive: true });
const runtimeVendor = join(root, "resources", "viniper-ui", "harness-runtime", "vendor");
mkdirSync(runtimeVendor, { recursive: true });
cpSync(join(root, "node_modules", "typescript", "lib", "typescript.js"), join(runtimeVendor, "typescript.js"));
