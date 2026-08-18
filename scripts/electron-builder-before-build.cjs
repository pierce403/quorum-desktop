/**
 * The renderer is a self-contained Vite bundle, and Electron's main/preload
 * files import only Electron, Node built-ins, and sibling files. No runtime
 * node_modules need to be copied or rebuilt. Returning false is electron-
 * builder's supported signal that dependencies are handled externally.
 */
module.exports = async function skipElectronDependencyRebuild() {
  return false;
};
