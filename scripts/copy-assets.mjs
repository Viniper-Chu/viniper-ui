import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const destination = join(root, "dist", "src", "renderer");
mkdirSync(destination, { recursive: true });
cpSync(join(root, "src", "renderer"), destination, { recursive: true });

const desktopAssets = join(root, "dist", "src", "platform", "desktop");
mkdirSync(desktopAssets, { recursive: true });
cpSync(join(root, "skills"), join(desktopAssets, "skills"), { recursive: true });
cpSync(join(root, "plugins"), join(desktopAssets, "plugins"), { recursive: true });

const brandingAssets = join(root, "assets", "branding");
cpSync(brandingAssets, join(root, "dist", "assets", "branding"), { recursive: true });
