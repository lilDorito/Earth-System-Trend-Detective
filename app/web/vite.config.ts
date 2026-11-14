import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// in prod: set VITE_API_URL
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // VITE_API_TARGET: use another port if 8000 is taken (Windows: WinError 10013)
  server: { proxy: { "/api": process.env.VITE_API_TARGET ?? "http://localhost:8000" } },
});
