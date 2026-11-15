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
        // "r3" in every file name: offline caches from before service worker v3 could hold the HTML page in place
        // of a stylesheet or script under the old names, so this release asks for none of those names again
        entryFileNames: "assets/[name]-r3-[hash].js",
        chunkFileNames: "assets/[name]-r3-[hash].js",
        assetFileNames: "assets/[name]-r3-[hash][extname]",
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
