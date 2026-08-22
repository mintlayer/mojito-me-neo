module.exports = function (api) {
  api.cache(true);
  return {
    // `jsxImportSource: 'nativewind'` is the whole className mechanism. The
    // extra 'nativewind/babel' preset is deliberately omitted: on nativewind
    // 4.2 it hard-requires react-native-worklets/plugin (reanimated 4), which
    // conflicts with the reanimated 3.x that Expo SDK 53 pins.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]],
  };
};
