import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgrPlugin from "vite-plugin-svgr";

// The canvas runs the editor straight from the workspace sources, the same way
// `excalidraw-app` does, so what an agent draws is measured and rendered by the
// exact code a person edits it with.
const pkg = (p: string) => path.resolve(__dirname, "../packages", p);

const aliases: [string, string][] = [
  ["common", pkg("common/src/index.ts")],
  ["element", pkg("element/src/index.ts")],
  ["math", pkg("math/src/index.ts")],
  ["utils", pkg("utils/src/index.ts")],
  ["fractional-indexing", pkg("fractional-indexing/src/index.ts")],
  ["laser-pointer", pkg("laser-pointer/src/index.ts")],
];

export default defineConfig({
  root: __dirname,
  clearScreen: false,
  resolve: {
    alias: [
      ...aliases.flatMap(([name, entry]) => [
        { find: new RegExp(`^@excalidraw/${name}$`), replacement: entry },
        {
          find: new RegExp(`^@excalidraw/${name}/(.*?)`),
          replacement: path.dirname(entry) + "/$1",
        },
      ]),
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: pkg("excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: pkg("excalidraw/$1"),
      },
    ],
  },
  plugins: [react(), svgrPlugin()],
});
