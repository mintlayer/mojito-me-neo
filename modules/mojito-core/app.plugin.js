// Config plugin anchor for the local MojitoCore module. The native module
// itself is autolinked from modules/ (expo-module.config.json, build.gradle,
// podspec); declaring the plugin here keeps the module visible in app config
// and gives M1 a place for any native project tweaks.
module.exports = function withMojitoCore(config) {
  return config;
};
