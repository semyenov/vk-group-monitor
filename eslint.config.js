import pluginJs from "@eslint/js";
import { default as pluginHtml } from "@html-eslint/eslint-plugin";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

import htmlParser from "@html-eslint/parser";

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,html,vue}"],
  },
  {
    ...pluginHtml.configs["flat/recommended"],
    files: ["**/*.html"],
    plugins: {
      "@html-eslint": htmlParser,
    },
    languageOptions: {
      parser: htmlParser,
    },
    rules: {
      ...pluginHtml.configs["flat/recommended"].rules,
      "@html-eslint/indent": "error",
    },
  },
  {
    ...pluginVue.configs["flat/recommended"],
    files: ["**/*.vue"],
    rules: {
      ...pluginVue.configs["flat/recommended"].rules,
      "@vue/html-indent": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.nodeBuiltin,
        ...globals.es2025
      },
      parserOptions: {
        ecmaVersion: 2025,
        sourceType: "module",
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
];
