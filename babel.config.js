module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // reanimated 4 ships its worklets plugin here; must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
