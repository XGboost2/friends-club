import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { proxy: { "/api": "http://localhost:3000" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "vendor-react";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "vendor-react";
          if (id.includes("@clerk/")) return "vendor-clerk";
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "vendor-motion";
          if (id.includes("lucide-react") || id.includes("sonner")) return "vendor-ui";
        },
      },
    },
  },
});
