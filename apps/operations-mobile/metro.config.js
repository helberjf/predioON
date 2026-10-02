const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const workspaceRoot = path.resolve(__dirname, "../..");
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    resolveRequest(context, moduleName, platform) {
      // A workspace package must resolve the app's React instance.
      if (
        moduleName === "react" ||
        moduleName.startsWith("react/") ||
        moduleName === "react-native" ||
        moduleName.startsWith("react-native/")
      ) {
        return context.resolveRequest(
          { ...context, originModulePath: path.join(__dirname, "index.js") },
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
