import { readFileSync } from "node:fs";
import { join } from "node:path";

type BrandingAssetKey = "asset" | "nativeFallback" | "nativeSmall" | "windowsIco";

interface BrandingManifest {
  asset: string;
  nativeFallback: string;
  nativeSmall: string;
  windowsIco: string;
}

const manifestByAppPath = new Map<string, BrandingManifest>();

export function getBrandingAssetPath(appPath: string, key: BrandingAssetKey): string {
  const manifest = manifestByAppPath.get(appPath) ?? loadManifest(appPath);
  return join(appPath, "assets", "branding", manifest[key]);
}

function loadManifest(appPath: string): BrandingManifest {
  const manifestPath = join(appPath, "assets", "branding", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BrandingManifest;
  manifestByAppPath.set(appPath, manifest);
  return manifest;
}
