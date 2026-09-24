import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site under /o-dio/; local dev and other hosts use /.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? "/o-dio/" : "/",
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
});
