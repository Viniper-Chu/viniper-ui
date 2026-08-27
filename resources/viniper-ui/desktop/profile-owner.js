const path = require("path");

function isPackagedWorkstationExecutable(execPath) {
  const value = String(execPath || "");
  const executableName = path.basename(value, path.extname(value));
  return executableName.toLocaleLowerCase("en-US") === "viniper workstation";
}

function selectPreviewProfile({ envPreview, packaged, execPath, metadataProfile, previewMarker }) {
  if (envPreview === "0" || metadataProfile === "stable") return false;
  return envPreview === "1"
    || metadataProfile === "preview"
    || Boolean(previewMarker)
    || (Boolean(packaged) && isPackagedWorkstationExecutable(execPath) && !metadataProfile);
}

function normalizeOwnerPath(value) {
  return path.resolve(String(value || "")).toLocaleLowerCase("en-US");
}

function statusMatchesProfile(status, expected) {
  if (!status || typeof status !== "object") return false;
  if (Boolean(status.preview) !== Boolean(expected.preview)) return false;
  if (String(status.active_profile || "") !== String(expected.activeProfile || "")) return false;
  if (String(status.product_name || "") !== String(expected.productName || "")) return false;
  if (expected.dataDir && normalizeOwnerPath(status.data_dir) !== normalizeOwnerPath(expected.dataDir)) return false;
  return true;
}

module.exports = {
  isPackagedWorkstationExecutable,
  selectPreviewProfile,
  statusMatchesProfile,
};
