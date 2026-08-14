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
        manualChunks: {
          icons: ["lucide-react"],
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
