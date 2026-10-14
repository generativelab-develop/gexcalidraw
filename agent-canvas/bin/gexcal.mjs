#!/usr/bin/env node
/* eslint-disable no-console -- printing is this program's job */
// gexcal: draw on a live Excalidraw canvas from the command line.
// `gexcal help` prints the usage; AGENTS.md beside this package explains the
// workflow an agent should follow.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { readState, revisionsDir, stateFile } from "../server/util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `gexcal: draw on a live Excalidraw canvas

server
  gexcal open <file.excalidraw> [--port 5199] [--no-browser] [--no-headless]
        start the canvas for <file> (created if missing) and open it in the browser
  gexcal status                 which file is open, which canvases are connected
  gexcal stop                   stop the canvas server

draw (ids are yours: letters, digits, _ . : - >; an edge is from->to by default)
  gexcal node <id> <label> [--shape rect|ellipse|diamond] [--kind K] [--group G]
                           [--color C] [--source PATH] [--at X,Y]
  gexcal edge <from> <to> [label] [--id ID] [--line solid|dashed|dotted] [--color C]
  gexcal group <id> <label> [--parent G] [--color C]
  gexcal note <text> [--on ID] [--id ID] [--color C] [--at X,Y]
  gexcal remove <id>...
  gexcal layout [--direction RIGHT|DOWN|LEFT|UP] [--keep-pinned]
  gexcal theme clean|sketch
  gexcal apply [ops.json | -]   several ops at once: {"ops":[...]} or [...]
  gexcal mermaid [file.mmd | -] [--prefix P] [--print]
                                draw a Mermaid flowchart as nodes/edges/groups
                                (--print shows the ops instead of drawing them)
  gexcal clear                  remove everything the agent drew
  gexcal undo                   undo the last change on the canvas

read
  gexcal describe [--json]      the diagram as text, with layout problems
  gexcal export <out.png|out.svg> [--ids a,b] [--scale 2] [--dark]
  gexcal fit [id...]            move the open canvas to show these (or everything)

history (every write keeps the previous version)
  gexcal revisions [file]       earlier versions of the scene, newest last
  gexcal restore <revision> [file]   put an earlier version back (the open canvas follows)

kinds: service api ui client user actor store db database file queue topic
       job worker process external decision config
colors: blue green red yellow orange violet pink teal gray black or #rrggbb
`;

const die = (message, code = 1) => {
  process.stderr.write(`gexcal: ${message}\n`);
  process.exit(code);
};

const server = () => {
  const state = readState();
  if (!state) {
    die("no canvas is running; start one with `gexcal open <file.excalidraw>`");
  }
  return state;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const call = async (state, route, body) => {
  let res;
  try {
    res = await fetch(`${state.url}gx/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-gexcal-token": state.token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    die(
      `the canvas server at ${state.url} is not answering (${
        error.cause?.code ?? error.message
      }); run \`gexcal open\` again`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    die(data.error ?? `HTTP ${res.status}`);
  }
  return data;
};

const request = async (kind, payload) =>
  (await call(server(), "request", { kind, payload })).result;

const parsePoint = (value, flag) => {
  if (value === undefined) {
    return undefined;
  }
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    die(`${flag} takes X,Y`);
  }
  return parts;
};

const printApply = (result) => {
  for (const warning of result.warnings ?? []) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  const issues = result.description
    .split("\n")
    .filter((l) => l.startsWith("  ["));
  const changed = [
    result.touched.length ? `drew ${result.touched.join(", ")}` : null,
    result.removed.length ? `removed ${result.removed.join(", ")}` : null,
  ].filter(Boolean);
  console.log(`${changed.join("; ") || "no change"} (${result.layout} layout)`);
  if (issues.length) {
    console.log(`issues:\n${issues.join("\n")}`);
  }
};

/** The scene named on the command line, else the one the canvas has open. */
const sceneFile = (given) => {
  if (given) {
    return path.resolve(given);
  }
  const state = readState();
  if (!state) {
    die("name the .excalidraw file (no canvas is running)", 2);
  }
  return state.file;
};

const apply = async (ops) => printApply(await request("apply", { ops }));

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const openBrowser = (url) => {
  const cmd =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
};

const waitForState = async (pid, ms = 30_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = readState();
    if (state?.pid === pid) {
      return state;
    }
    if (!alive(pid)) {
      return null;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};

const commands = {
  async help() {
    process.stdout.write(USAGE);
  },

  async open(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: "string", default: "5199" },
        "no-browser": { type: "boolean", default: false },
        "no-headless": { type: "boolean", default: false },
      },
    });
    if (positionals.length !== 1) {
      die("open takes exactly one <file.excalidraw>", 2);
    }
    const file = path.resolve(positionals[0]);
    const running = readState();
    if (running && alive(running.pid)) {
      if (running.file === file) {
        console.log(`already open: ${running.url}  (scene ${file})`);
        if (!values["no-browser"]) {
          openBrowser(running.url);
        }
        return;
      }
      console.log(`closing the canvas for ${running.file}`);
      await call(running, "shutdown", {}).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
    }
    const logDir = path.dirname(stateFile());
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, "server.log"), "a");
    const args = [
      path.join(here, "../server/serve.mjs"),
      "--file",
      file,
      "--port",
      values.port,
    ];
    if (values["no-headless"]) {
      args.push("--no-headless");
    }
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", log, log],
      cwd: path.join(here, ".."),
    });
    child.unref();
    const state = await waitForState(child.pid);
    if (!state) {
      die(
        `the canvas server did not start; see ${path.join(
          logDir,
          "server.log",
        )}`,
      );
    }
    console.log(`canvas: ${state.url}  (scene ${file})`);
    if (!values["no-browser"]) {
      openBrowser(state.url);
    }
  },

  async status() {
    const state = readState();
    if (!state || !alive(state.pid)) {
      console.log("no canvas is running");
      return;
    }
    const status = await call(state, "status");
    console.log(`canvas: ${state.url}\nscene:  ${status.file}`);
    console.log(
      `canvases connected: ${
        status.clients.length
          ? status.clients
              .map((c) => `${c.id}${c.headless ? " (headless)" : ""}`)
              .join(", ")
          : "none (a headless one starts on the next request)"
      }`,
    );
  },

  async stop() {
    const state = readState();
    if (!state || !alive(state.pid)) {
      console.log("no canvas is running");
      return;
    }
    await call(state, "shutdown", {});
    const until = Date.now() + 8000;
    while (alive(state.pid) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (alive(state.pid)) {
      die(`the canvas server (pid ${state.pid}) did not exit`);
    }
    console.log("stopped");
  },

  async node(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        shape: { type: "string" },
        kind: { type: "string" },
        group: { type: "string" },
        color: { type: "string" },
        source: { type: "string" },
        at: { type: "string" },
      },
    });
    const [id, ...label] = positionals;
    if (!id) {
      die("node <id> <label>", 2);
    }
    await apply([
      {
        op: "node",
        id,
        label: label.length ? label.join(" ") : undefined,
        shape: values.shape,
        kind: values.kind,
        group: values.group,
        color: values.color,
        source: values.source,
        at: parsePoint(values.at, "--at"),
      },
    ]);
  },

  async edge(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        id: { type: "string" },
        line: { type: "string" },
        color: { type: "string" },
      },
    });
    const [from, to, ...label] = positionals;
    if (!from || !to) {
      die("edge <from> <to> [label]", 2);
    }
    await apply([
      {
        op: "edge",
        id: values.id,
        from,
        to,
        label: label.length ? label.join(" ") : undefined,
        line: values.line,
        color: values.color,
      },
    ]);
  },

  async group(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { parent: { type: "string" }, color: { type: "string" } },
    });
    const [id, ...label] = positionals;
    if (!id) {
      die("group <id> <label>", 2);
    }
    await apply([
      {
        op: "group",
        id,
        label: label.length ? label.join(" ") : undefined,
        parent: values.parent,
        color: values.color,
      },
    ]);
  },

  async note(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        on: { type: "string" },
        id: { type: "string" },
        color: { type: "string" },
        at: { type: "string" },
      },
    });
    if (!positionals.length) {
      die("note <text> [--on ID]", 2);
    }
    await apply([
      {
        op: "note",
        id: values.id,
        text: positionals.join(" ").replace(/\\n/g, "\n"),
        on: values.on,
        color: values.color,
        at: parsePoint(values.at, "--at"),
      },
    ]);
  },

  async remove(argv) {
    if (!argv.length) {
      die("remove <id>...", 2);
    }
    await apply(argv.map((id) => ({ op: "remove", id })));
  },

  async layout(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        direction: { type: "string" },
        "keep-pinned": { type: "boolean", default: false },
      },
    });
    await apply([
      {
        op: "layout",
        direction: values.direction?.toUpperCase(),
        keepPinned: values["keep-pinned"],
      },
    ]);
  },

  async theme(argv) {
    if (argv.length !== 1) {
      die("theme clean|sketch", 2);
    }
    await apply([{ op: "meta", theme: argv[0] }]);
  },

  async clear() {
    await apply([{ op: "clear" }]);
  },

  async apply(argv) {
    const source = argv[0] ?? "-";
    const text =
      source === "-" ? await readStdin() : fs.readFileSync(source, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      die(`ops are not valid JSON: ${error.message}`, 2);
    }
    const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
    if (!Array.isArray(ops)) {
      die('expected {"ops": [...]} or a JSON array of ops', 2);
    }
    await apply(ops);
  },

  async mermaid(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        prefix: { type: "string" },
        print: { type: "boolean", default: false },
      },
    });
    const source = positionals[0] ?? "-";
    const definition =
      source === "-" ? await readStdin() : fs.readFileSync(source, "utf8");
    const result = await request("mermaid", {
      definition,
      prefix: values.prefix,
      print: values.print,
    });
    if (values.print) {
      console.log(JSON.stringify({ ops: result.ops }, null, 2));
      return;
    }
    printApply(result.applied);
  },

  async undo() {
    await request("undo", {});
    console.log("undone");
  },

  async describe(argv) {
    const { values } = parseArgs({
      args: argv,
      options: { json: { type: "boolean", default: false } },
    });
    const result = await request("describe", {});
    console.log(
      values.json ? JSON.stringify(result.json, null, 2) : result.text,
    );
  },

  async export(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ids: { type: "string" },
        scale: { type: "string" },
        dark: { type: "boolean", default: false },
        padding: { type: "string" },
      },
    });
    const out = positionals[0];
    if (!out || !/\.(png|svg)$/i.test(out)) {
      die("export <out.png|out.svg>", 2);
    }
    const format = out.toLowerCase().endsWith(".svg") ? "svg" : "png";
    const result = await request("export", {
      format,
      ids: values.ids?.split(",").filter(Boolean),
      scale: values.scale ? Number(values.scale) : undefined,
      dark: values.dark,
      padding: values.padding ? Number(values.padding) : undefined,
    });
    fs.writeFileSync(
      out,
      result.encoding === "base64"
        ? Buffer.from(result.data, "base64")
        : result.data,
    );
    console.log(path.resolve(out));
  },

  async revisions(argv) {
    const file = sceneFile(argv[0]);
    const dir = revisionsDir(file);
    const list = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".excalidraw"))
          .sort()
      : [];
    if (!list.length) {
      console.log(`no earlier versions of ${file}`);
      return;
    }
    for (const name of list) {
      let count = "?";
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        count = data.elements.filter((e) => !e.isDeleted).length;
      } catch {}
      console.log(`${name.replace(/\.excalidraw$/, "")}  ${count} elements`);
    }
  },

  async restore(argv) {
    const [revision, maybeFile] = argv;
    if (!revision) {
      die("restore <revision> [file]  (see `gexcal revisions`)", 2);
    }
    const file = sceneFile(maybeFile);
    const dir = revisionsDir(file);
    const source = path.join(
      dir,
      `${revision.replace(/\.excalidraw$/, "")}.excalidraw`,
    );
    if (!fs.existsSync(source)) {
      die(`no revision "${revision}" for ${file}`);
    }
    // the version being replaced is kept too
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(file, path.join(dir, `${stamp}.excalidraw`));
    }
    fs.copyFileSync(source, file);
    console.log(`restored ${revision} into ${file}`);
  },

  async fit(argv) {
    const result = await request("fit", { ids: argv });
    console.log(`showing ${result.fitted} elements`);
  },
};

const [command = "help", ...rest] = process.argv.slice(2);
const run =
  commands[command === "--help" || command === "-h" ? "help" : command];
if (!run) {
  die(`unknown command "${command}"; see \`gexcal help\``, 2);
}
await run(rest);
