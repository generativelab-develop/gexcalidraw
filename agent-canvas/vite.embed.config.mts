import fs from "fs";
import path from "path";

import { transform } from "esbuild";
import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config.mts";

// `yarn build:embed` builds the canvas for a host page (src/embed.tsx) into
// dist-embed/: one ES module with React and every font it can load, no
// dynamic import and no network reference, so a host with a strict
// same-origin policy can serve the directory as it is.
//
// The Hangul faces (packages/excalidraw/fonts/{Pretendard,Gaegu,…}) are the
// one exception to "inside the module": several megabytes a page needs only
// once Korean is drawn, so they are written to dist-embed/fonts/ and named
// relative to the module, which the browser fetches from the same origin. Each
// travels with its licence (fonts/<family>.OFL.txt).
const HANGUL_FONT =
  /[\\/]fonts[\\/](Pretendard|Gaegu|NanumPenScript|GowunDodum|Jua|D2Coding)[\\/][^\\/]+\.woff2$/;

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
        {
          find: /^\.\.\/subset\/subset-main$/,
          replacement: path.resolve(__dirname, "embed/no-font-subset.ts"),
        },
      ],
    },
    plugins: [
      {
        name: "hangul-fonts-beside-the-module",
        enforce: "pre",
        load(id) {
          if (!HANGUL_FONT.test(id)) {
            return null;
          }
          const name = path.basename(id);
          this.emitFile({
            type: "asset",
            fileName: `fonts/${name}`,
            source: fs.readFileSync(id),
          });
          this.emitFile({
            type: "asset",
            fileName: `fonts/${path.basename(path.dirname(id))}.OFL.txt`,
            source: fs.readFileSync(path.join(path.dirname(id), "OFL.txt")),
          });
          // a variable base keeps Vite from inlining the URL as an asset
          return `const base = import.meta.url; export default new URL("fonts/" + ${JSON.stringify(
            name,
          )}, base).href;`;
        },
      },
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
