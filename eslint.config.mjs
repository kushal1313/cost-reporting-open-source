import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-verify/**",
      "**/generated/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prisma/Fastify/connector code intentionally uses `unknown`-typed
      // config objects at trust boundaries; `any` shows up there too
      // (e.g. the connector registry). Warn, don't block, on this one.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // This rule is right that setState-to-sync-with-props inside an effect
      // is usually a bug (we fixed two real instances of that). But it also
      // flags the standard "setLoading(true) at the top of a data-fetching
      // effect" pattern, which is a legitimate, unavoidable use of an effect
      // (not derivable from render) — warn on it, don't block CI over it.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  prettierConfig,
);
