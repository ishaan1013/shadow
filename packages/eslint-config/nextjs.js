import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import pluginNext from "@next/eslint-plugin-next";
import tailwindPlugin from "eslint-plugin-tailwindcss";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    plugins: {
      tailwindcss: tailwindPlugin,
    },
    rules: {
      "tailwindcss/classnames-order": "error",
      "tailwindcss/no-custom-classname": "off", // Allow custom classes
      "tailwindcss/no-contradicting-classname": "error",
    },
    settings: {
      tailwindcss: {
        callees: ["cn", "clsx", "cva", "twMerge"],
        config: "./tailwind.config.ts",
      },
    },
  },
];

// Default export for backward compatibility
export default nextJsConfig;
