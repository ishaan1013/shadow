import baseConfig from "@repo/eslint-config/node.js";

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
  },
];