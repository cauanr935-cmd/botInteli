import { defineConfig } from "vitest/config";

// PGlite (Postgres em WASM) demora para subir quando vários arquivos de teste rodam em paralelo.
export default defineConfig({
  test: { setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
});
