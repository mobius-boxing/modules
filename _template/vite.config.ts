import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev port registered in the README port table — one per module, 3030+.
export default defineConfig({
  plugins: [react()],
  server: { port: 3030 },
});
