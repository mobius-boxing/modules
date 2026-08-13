import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev port registered in the README port table — one per module, 3030+.
//
// The app always calls a relative /api; in dev this proxy is what makes that
// same-origin call reach mobius-api. Never hardcode an origin in app code.
// mobius-api listens on 3001 locally (project convention — the code's 3005
// fallback only applies when PORT is unset).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3040,
    proxy: { "/api": "http://localhost:3001" },
  },
  build: { outDir: "dist", sourcemap: false },
});
