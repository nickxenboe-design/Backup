import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "dist/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-undef": "off",
      "no-irregular-whitespace": "off",
      "no-constant-condition": "off",
      "no-case-declarations": "off",
      "no-dupe-keys": "off",
      "no-unreachable": "off",
      "no-async-promise-executor": "off",
      "no-dupe-class-members": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
