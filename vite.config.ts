import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Single-file-ish deploy target: `vite build` emits a static `dist/`
// directory that any dumb static host (GitHub Pages, S3, Cloudflare
// Pages, Netlify, nginx in a Docker image) will serve without any
// routing config. We use HashRouter at the React layer so deep links
// like #/dashboard survive a page refresh without server rewrites.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // Relative base lets the build work from any mount point, including
  // GitHub Pages project subpaths (e.g. /maverick-ambitions/).
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
