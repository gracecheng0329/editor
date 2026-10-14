import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import js from "@eslint/js";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  // Next.js output, local verification output, and generated artifacts.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-g0/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent skill packages contain their own tools and configuration templates.
    ".agents/**",
    "node_modules/**",
    "public/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    ".pnpm-store/**",
    "dist/**",
    ".turbo/**",
    ".vercel/**",
  ]),
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react/jsx-no-target-blank": "error",
      "react/display-name": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
