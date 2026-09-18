module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // react-native-worklets/plugin is required by react-native-reanimated v4
    // and must remain the LAST plugin in this list.
    plugins: ['react-native-worklets/plugin'],
  };
};
