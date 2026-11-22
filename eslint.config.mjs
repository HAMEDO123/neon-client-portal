import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts",
    // The WhatsApp reply desk: a plain Node program with its own container,
    // not part of the Next app (Baileys' useMultiFileAuthState is not a React hook).
    "whatsapp-desk/**"]),
]);

export default eslintConfig;
