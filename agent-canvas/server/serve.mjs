#!/usr/bin/env node
/* eslint-disable no-console -- printing is this program's job */
// Runs the canvas server in the foreground: the Vite dev server for the canvas
// page plus the gexcal bridge. `gexcal open` starts this detached; run it by
// hand to see its log.
//
//   node server/serve.mjs --file arch.excalidraw [--port 5199] [--no-headless]

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createServer } from "vite";

import { gexcalBridge } from "./bridge.mjs";
import { clearState, writeState } from "./util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    port: { type: "string", default: "5199" },
    "no-headless": { type: "boolean", default: false },
  },
});

if (!values.file) {
  console.error("serve: --file is required");
  process.exit(2);
}

const file = path.resolve(values.file);
const token = crypto.randomBytes(24).toString("hex");

const server = await createServer({
  configFile: path.join(here, "../vite.config.mts"),
  server: {
    host: "127.0.0.1",
    port: Number(values.port),
    strictPort: false,
    open: false,
    // the canvas is a tool, not a page under development: never reload it
    // under an agent's feet (set GEXCAL_DEV=1 to work on the canvas itself)
    watch: process.env.GEXCAL_DEV ? undefined : null,
    hmr: process.env.GEXCAL_DEV ? undefined : { overlay: false },
  },
  logLevel: "warn",
  plugins: [
    gexcalBridge({
      file,
      token,
      headless: !values["no-headless"],
      onShutdown: () => {
        clearState(process.pid);
        server.close().finally(() => process.exit(0));
      },
    }),
  ],
});

await server.listen();
const { port } = server.httpServer.address();
const url = `http://127.0.0.1:${port}/`;

writeState({ pid: process.pid, port, url, file, token, started: Date.now() });
console.log(`gexcal canvas: ${url}  (scene ${file})`);

const stop = () => {
  clearState(process.pid);
  server.close().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
