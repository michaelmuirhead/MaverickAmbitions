import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM doesn't have __dirname natively — reconstruct it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single-file-ish deploy target: `vite build` emits a static `dist/`
// directory that any dumb static host (GitHub Pages, S3, Cloudflare
// Pages, Netlify, Vercel, nginx in a Docker image) will serve without
// any routing config. We use HashRouter at the React layer so deep
// links like #/dashboard survive a page refresh without server rewrites.
export default defineConfig({
  plugins: [react()],
  // Relative base lets the build work from any mount point, including
  // GitHub Pages project subpaths (e.g. /maverick-ambitions/).
  base: "./",
  resolve: {
    alias: {
      // Mirror the `@/* -> src/*` path alias from tsconfig.json so the
      // build resolver matches the TypeScript resolver exactly. We used
      // to rely on `vite-tsconfig-paths`, but it turned out to be
      // flaky on some hosts (Vercel Linux in particular); defining the
      // alias inline is bulletproof and has zero runtime cost.
      "@": path.resolve(__dirname, "src"),
    },
  },
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
