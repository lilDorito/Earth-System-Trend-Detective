import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { proxy: { "/api": process.env.VITE_API_TARGET ?? "http://localhost:8000" } },
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/](three|three-stdlib|@react-three|camera-controls|maath)[\\/]/ },
            { name: "echarts", test: /node_modules[\\/](echarts|zrender|echarts-for-react)[\\/]/ },
          ],
        },
      },
    },
  },
});
