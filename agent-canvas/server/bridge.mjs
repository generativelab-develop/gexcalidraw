// The bridge between the `gexcal` CLI and the canvas pages.
//
// The scene FILE on disk is the source of truth. A canvas page (a person's
// browser tab, or a headless Chrome when nobody has one open) is the ENGINE:
// it runs the real Excalidraw code, so every label is measured and every arrow
// bound exactly as the editor would do it. The CLI never edits the file
// itself; it asks the bridge, the bridge asks the engine, the engine updates
// the scene, and the scene comes back here to be written.
//
// Transport is Vite's own HMR websocket (custom events), so there is no second
// socket server. The HTTP API is token-guarded and bound to loopback.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  emptyScene,
  findChrome,
  revisionsDir,
  spawnHeadless,
} from "./util.mjs";

const KEEP_REVISIONS = 200;

const REQUEST_TIMEOUT_MS = 60_000;
const ENGINE_WAIT_MS = 30_000;

export function gexcalBridge({ file, token, headless = true, onShutdown }) {
  /** @type {Map<object, {id: string, headless: boolean, at: number}>} */
  const clients = new Map();
  /** @type {Map<string, {resolve: Function, reject: Function, timer: any}>} */
  const pending = new Map();
  const engineWaiters = new Set();
  let lastWritten = null;
  let headlessChild = null;
  let queue = Promise.resolve();
  let server;
  let watchTimer = null;
  let clientSeq = 0;

  const readScene = () => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        const scene = emptyScene();
        writeScene(scene);
        return scene;
      }
      throw error;
    }
  };

  // every version the file had is kept, so nothing an agent or a racing tab
  // writes is unrecoverable (`gexcal revisions`, `gexcal restore`)
  const keepRevision = () => {
    let current;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const dir = revisionsDir(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `${stamp}.excalidraw`), current);
    const all = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".excalidraw"))
      .sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_REVISIONS))) {
      fs.rmSync(path.join(dir, old), { force: true });
    }
  };

  const writeScene = (text) => {
    if (text === lastWritten) {
      return false;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    keepRevision();
    const tmp = `${file}.gexcal-tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    lastWritten = text;
    return true;
  };

  const leader = () => {
    let best = null;
    for (const [client, info] of clients) {
      if (
        !best ||
        (best.info.headless && !info.headless) ||
        (best.info.headless === info.headless && info.at > best.info.at)
      ) {
        best = { client, info };
      }
    }
    return best;
  };

  const broadcast = (event, data, except) => {
    for (const client of clients.keys()) {
      if (client !== except) {
        client.send(event, data);
      }
    }
  };

  const waitForEngine = async () => {
    if (leader()) {
      return leader();
    }
    if (!headless) {
      throw new Error(
        "no canvas is open: open the canvas URL in a browser, or restart with headless allowed",
      );
    }
    if (!headlessChild) {
      const chrome = findChrome();
      if (!chrome) {
        throw new Error(
          "no canvas is open and no Chrome/Chromium was found for a headless canvas (set GEXCAL_CHROME)",
        );
      }
      const { port } = server.config.server;
      const address = server.httpServer.address();
      const url = `http://127.0.0.1:${address?.port ?? port}/?engine=headless`;
      headlessChild = spawnHeadless(chrome, url);
      headlessChild.on("exit", () => {
        headlessChild = null;
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        engineWaiters.delete(waiter);
        reject(new Error("timed out waiting for the headless canvas to start"));
      }, ENGINE_WAIT_MS);
      const waiter = () => {
        clearTimeout(timer);
        engineWaiters.delete(waiter);
        resolve(leader());
      };
      engineWaiters.add(waiter);
    });
  };

  const request = (kind, payload) => {
    const run = async () => {
      const engine = await waitForEngine();
      const reqId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          reject(new Error(`the canvas did not answer "${kind}" in time`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(reqId, { resolve, reject, timer });
        engine.client.send("gx:req", { reqId, kind, payload });
      });
    };
    // one request at a time: an agent's ops are applied in the order sent
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const sendJSON = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  const watchFile = () => {
    // an edit made to the file by something else (a person's editor, git)
    // reaches every open canvas
    fs.watchFile(file, { interval: 300 }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        let text;
        try {
          text = fs.readFileSync(file, "utf8");
        } catch {
          return;
        }
        if (text !== lastWritten) {
          lastWritten = text;
          broadcast("gx:load", { scene: text, file, reason: "file-changed" });
        }
      }, 100);
    });
  };

  let shutDown = false;
  // closing the server emits "close", which lands here again: run once
  const shutdown = () => {
    if (shutDown) {
      return;
    }
    shutDown = true;
    fs.unwatchFile(file);
    if (headlessChild) {
      headlessChild.kill();
      headlessChild = null;
    }
    onShutdown?.();
  };

  return {
    name: "gexcal-bridge",
    configureServer(viteServer) {
      server = viteServer;
      lastWritten = readScene();
      watchFile();

      viteServer.ws.on("gx:hello", (data, client) => {
        const info = {
          id: `c${++clientSeq}`,
          headless: !!data?.headless,
          at: Date.now(),
        };
        clients.set(client, info);
        client.socket?.on?.("close", () => {
          clients.delete(client);
        });
        client.send("gx:load", {
          scene: lastWritten ?? readScene(),
          file,
          reason: "hello",
          clientId: info.id,
        });
        for (const waiter of [...engineWaiters]) {
          waiter();
        }
        // a person opened the canvas: the headless engine is no longer needed
        if (!info.headless && headlessChild) {
          headlessChild.kill();
          headlessChild = null;
        }
      });

      viteServer.ws.on("gx:scene", (data, client) => {
        if (typeof data?.scene !== "string") {
          return;
        }
        if (writeScene(data.scene)) {
          broadcast("gx:scene", { scene: data.scene }, client);
        }
      });

      viteServer.ws.on("gx:res", (data) => {
        const entry = pending.get(data?.reqId);
        if (!entry) {
          return;
        }
        pending.delete(data.reqId);
        clearTimeout(entry.timer);
        if (data.ok) {
          entry.resolve(data.result);
        } else {
          entry.reject(
            new Error(data.error || "the canvas refused the request"),
          );
        }
      });

      viteServer.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/gx/api/")) {
          return next();
        }
        if (req.headers["x-gexcal-token"] !== token) {
          return sendJSON(res, 403, { error: "bad or missing token" });
        }
        const route = req.url.slice("/gx/api/".length).split("?")[0];
        try {
          if (route === "status" && req.method === "GET") {
            const lead = leader();
            return sendJSON(res, 200, {
              file,
              pid: process.pid,
              clients: [...clients.values()],
              leader: lead?.info.id ?? null,
              headlessRunning: !!headlessChild,
            });
          }
          if (route === "request" && req.method === "POST") {
            const body = JSON.parse((await readBody(req)) || "{}");
            const result = await request(body.kind, body.payload ?? {});
            return sendJSON(res, 200, { ok: true, result });
          }
          if (route === "shutdown" && req.method === "POST") {
            sendJSON(res, 200, { ok: true });
            setTimeout(shutdown, 50);
            return;
          }
          return sendJSON(res, 404, { error: `unknown route ${route}` });
        } catch (error) {
          return sendJSON(res, 500, { error: error.message });
        }
      });

      viteServer.httpServer?.on("close", shutdown);
    },
  };
}
