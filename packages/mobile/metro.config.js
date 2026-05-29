const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const mobileNodeModules = path.resolve(__dirname, "node_modules");
const workspaceNodeModules = path.resolve(__dirname, "..", "..", "node_modules");

config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [mobileNodeModules, workspaceNodeModules];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.resolve(__dirname, "node_modules/react"),
  "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime"),
  "react/jsx-dev-runtime": path.resolve(__dirname, "node_modules/react/jsx-dev-runtime"),
  "react-refresh": path.resolve(__dirname, "vendor/react-refresh")
};

module.exports = config;
