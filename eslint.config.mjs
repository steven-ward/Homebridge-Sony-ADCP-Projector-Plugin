import globals from "globals";
import pluginJs from "@eslint/js";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{js,mjs,cjs}"] },
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  pluginJs.configs.recommended,
  // Jest globals for test files
  {
    files: ["**/*.test.js", "tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
  // Downgrade no-empty to warn (pre-existing empty catch blocks in legacy code)
  {
    rules: {
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  // Ignore node_modules
  {
    ignores: ["node_modules/**"],
  },
];
