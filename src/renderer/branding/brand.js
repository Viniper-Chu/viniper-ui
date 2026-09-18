export const BRAND_NAME = "Viniper workstation";
export const BRAND_BADGE = "v1.8.2 · Stable（稳定版）";
export const BRAND_ASSET_STATUS = "UNIFIED_3D_NATIVE_SOURCE";

export function initializeBranding(root = document) {
  root.title = `${BRAND_NAME} · ${BRAND_BADGE}`;
  for (const element of root.querySelectorAll("[data-brand-name]")) element.textContent = BRAND_NAME;
  for (const element of root.querySelectorAll("[data-brand-badge]")) element.textContent = BRAND_BADGE;
  const mark = root.querySelector("[data-brand-mark]");
  if (!mark) return;
  if (mark instanceof HTMLImageElement) {
    mark.alt = "";
  } else {
    mark.textContent = "V";
  }
  mark.dataset.assetStatus = BRAND_ASSET_STATUS;
  mark.title = "Viniper workstation 立体电路节点品牌图标";
}
