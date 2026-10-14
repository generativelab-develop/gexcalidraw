import path from "path";

import { transform } from "esbuild";
import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config.mts";

// `yarn build:embed` builds the canvas for a host page (src/embed.tsx) into
// dist-embed/: one ES module with React and every font it can load, no
// dynamic import and no network reference, so a host with a strict
// same-origin policy can serve the directory as it is.
export default mergeConfig(
  base,
  defineConfig({
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.env.DEV": "false",
    },
    resolve: {
      alias: [
        {
          find: /^\.\/Xiaolai$/,
          replacement: path.resolve(__dirname, "embed/no-cjk-hand-font.ts"),
        },
      ],
    },
    plugins: [
      {
        // library builds keep whitespace; the host serves this file as is
        name: "minify-library",
        renderChunk: async (code) =>
          (await transform(code, { minify: true, format: "esm" })).code,
      },
    ],
    build: {
      outDir: path.resolve(__dirname, "dist-embed"),
      emptyOutDir: true,
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      sourcemap: false,
      minify: "esbuild",
      lib: {
        entry: path.resolve(__dirname, "src/embed.tsx"),
        formats: ["es"],
        fileName: () => "plan-canvas.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          assetFileNames: (asset) =>
            asset.name?.endsWith(".css")
              ? "plan-canvas.css"
              : "assets/[name]-[hash][extname]",
        },
      },
    },
  }),
);
