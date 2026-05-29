const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const vendorDir = path.join(projectRoot, "vendor", "react-refresh");
const targetDir = path.resolve(projectRoot, "..", "..", "node_modules", "react-native", "node_modules", "react-refresh");

function exists(dir) {
  try {
    fs.accessSync(dir);
    return true;
  } catch {
    return false;
  }
}

if (!exists(vendorDir)) {
  console.warn(`[repair-react-refresh] Skipping because vendor copy is missing: ${vendorDir}`);
  process.exit(0);
}

if (!exists(path.dirname(targetDir))) {
  console.warn(`[repair-react-refresh] Skipping because react-native dependency tree is missing: ${path.dirname(targetDir)}`);
  process.exit(0);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(vendorDir, targetDir, { recursive: true, force: true });

console.log(`[repair-react-refresh] Replaced nested react-refresh with a normal-file copy at ${targetDir}`);
