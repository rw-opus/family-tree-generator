import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unreachable": "error",
      // JSX references are not marked as used by ESLint without another plugin.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^(React|[A-Z])" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
