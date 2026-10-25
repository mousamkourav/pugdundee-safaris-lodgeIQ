// ESLint: the standard Next.js rules (React, hooks, accessibility basics,
// TypeScript). Run with:  npm run lint
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "design-reference/**", "public/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // older Lodge Reporting code uses `any` on purpose: flag it, do not fail the build
      "@typescript-eslint/no-explicit-any": "warn",
      // names starting with _ are kept on purpose
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
];

export default config;
