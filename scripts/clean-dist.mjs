import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const dist = resolve(join(projectRoot, "dist"));
if (dist !== join(projectRoot, "dist")) throw new Error("Unexpected build output path");
rmSync(dist, { recursive: true, force: true });

