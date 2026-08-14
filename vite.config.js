import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // tests/e2e/*.spec.js belong to Playwright. Without this, Vitest collects
    // them, cannot run them, and reports failing files with passing tests.
    include: ["tests/unit/**/*.test.{js,jsx}"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons";
          if (/node_modules[\\/]@supabase[\\/]supabase-js[\\/]/.test(id)) return "supabase";
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
});
