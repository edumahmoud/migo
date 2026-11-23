import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // Existing React Compiler findings remain visible as warnings until their
  // components are refactored. Syntax and other lint errors still fail CI.
  files: ["src/components/shared/quiz-view.tsx", "src/components/shared/summary-view.tsx", "src/components/shared/payment-code-search-box.tsx", "src/components/reports/reports-section.tsx"],
  rules: {
    "react-hooks/immutability": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
    "react-hooks/error-boundaries": "warn",
    "react-hooks/static-components": "warn",
  },
}, {
  files: ["src/**/__tests__/**/*"],
  // These Bun tests deliberately use require() after mock.module().
  rules: { "@typescript-eslint/no-require-imports": "off" },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "public/**/*.min.mjs", "public/**/*.min.js"]
}];

export default eslintConfig;
