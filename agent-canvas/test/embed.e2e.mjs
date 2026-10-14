/* eslint-disable no-console */
// The embeddable build under a strict same-origin policy: a host page with
// the Cerebrate Portal's Content-Security-Policy mounts dist-embed/, draws
// through `request`, and gets every change through `onSave` — with no
// policy violation (no eval, no off-origin font or script).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findChrome } from "../server/util.mjs";

// Usage: yarn build:embed && node agent-canvas/test/embed.e2e.mjs
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("SKIP embed.e2e: playwright-core is not installed");
  process.exit(0);
}

const dist = fileURLToPath(new URL("../dist-embed/", import.meta.url));
if (!fs.existsSync(path.join(dist, "plan-canvas.js"))) {
  console.log("FAIL dist-embed/ is missing: run `yarn build:embed` first");
  process.exit(1);
}

// the Portal's directives (cerebrate portal/svelte.config.js)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/plan-canvas.css">
<style>html,body,#host{margin:0;height:100%}</style></head>
<body><div id="host"></div><script type="module" src="/host.js"></script></body></html>`;

const HOST = `
import { mountPlanCanvas } from "/plan-canvas.js";
window.saved = [];
window.canvas = await mountPlanCanvas(document.getElementById("host"), {
  langCode: "ko-KR",
  onSave: (scene) => window.saved.push(scene),
});
window.canvas.load(JSON.stringify({ type: "excalidraw", elements: [] }), { fresh: true });
window.ready = true;
`;

const server = http.createServer((req, res) => {
  const name = req.url === "/" ? null : req.url.slice(1);
  const send = (type, body) => {
    res.writeHead(200, {
      "content-type": type,
      "content-security-policy": CSP,
    });
    res.end(body);
  };
  if (!name) {
    return send("text/html", PAGE);
  }
  if (name === "host.js") {
    return send("text/javascript", HOST);
  }
  const file = path.join(dist, name);
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  const type = name.endsWith(".css")
    ? "text/css"
    : name.endsWith(".woff2")
    ? "font/woff2"
    : "text/javascript";
  send(type, fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) {
    process.exitCode = 1;
  }
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const violations = [];
page.on("console", (m) => {
  if (/Content Security Policy|Refused to/.test(m.text())) {
    violations.push(m.text());
  }
});
page.on("pageerror", (e) => console.log("pageerror", e.message));

await page.goto(url);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });

const drew = await page.evaluate(() =>
  window.canvas.request("apply", {
    ops: [
      { op: "group", id: "cp", label: "Control plane" },
      { op: "node", id: "daemon", label: "cerebrated", group: "cp" },
      { op: "node", id: "portal", label: "포털", kind: "ui" },
      { op: "edge", from: "portal", to: "daemon", label: "action.start" },
      { op: "note", text: "메모는 상자 옆에 붙는다", on: "daemon" },
    ],
  }),
);
check(drew.ok, `the canvas draws through request (${JSON.stringify(drew)})`);

const described = await page.evaluate(() => window.canvas.request("describe"));
check(
  described.ok && /issues:?\s*none/.test(described.result.text ?? ""),
  "describe reports the drawing without layout issues",
);

const refused = await page.evaluate(() =>
  window.canvas.request("apply", { ops: [{ op: "edge", from: "x", to: "y" }] }),
);
check(
  !refused.ok && /op #1/.test(refused.error),
  `a refused op comes back as an error naming it (${refused.error})`,
);

await page.waitForTimeout(500);
const saved = await page.evaluate(() => window.saved.at(-1) ?? "");
check(
  saved.includes("gx-n-daemon") && saved.includes("포털"),
  "onSave received the drawn scene",
);

const mermaid = await page.evaluate(() =>
  window.canvas.request("mermaid", {
    definition: "flowchart LR\n  a[Start] --> b{Ok?}\n  b --> c((Done))",
    prefix: "m-",
  }),
);
check(
  mermaid.ok,
  `Mermaid draws under the policy (${JSON.stringify(mermaid).slice(0, 120)})`,
);

const exported = await page.evaluate(() =>
  window.canvas.request("export", { format: "png" }),
);
check(
  exported.ok &&
    exported.result.encoding === "base64" &&
    exported.result.data.length > 1000,
  "export returns a PNG",
);

// Korean is drawn in the Hangul face its family falls back to (the clean
// theme writes Nunito, whose fallback is Pretendard), fetched from
// dist-embed/fonts/ on the same origin
await page
  .waitForFunction(
    () =>
      [...document.fonts].some(
        (f) =>
          f.family.replace(/"/g, "") === "Pretendard" && f.status === "loaded",
      ),
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
const loaded = await page.evaluate(() =>
  [...document.fonts]
    .filter((f) => f.status === "loaded")
    .map((f) => f.family.replace(/"/g, "")),
);
check(
  loaded.includes("Pretendard"),
  `Korean text loads the Hangul face (${[...new Set(loaded)].join(", ")})`,
);

const svg = await page.evaluate(() =>
  window.canvas.request("export", { format: "svg" }),
);
const svgText = JSON.stringify(svg.result ?? {});
check(
  svg.ok && /font-family: Pretendard/.test(svgText),
  "an SVG export carries the Hangul face its Korean text is drawn in",
);

// the sketch theme writes Excalifont, whose Hangul fallback is hand-drawn
const sketched = await page.evaluate(() =>
  window.canvas.request("apply", { ops: [{ op: "meta", theme: "sketch" }] }),
);
await page
  .waitForFunction(
    () =>
      [...document.fonts].some(
        (f) => f.family.replace(/"/g, "") === "Gaegu" && f.status === "loaded",
      ),
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
const handLoaded = await page.evaluate(() =>
  [...document.fonts].some(
    (f) => f.family.replace(/"/g, "") === "Gaegu" && f.status === "loaded",
  ),
);
check(
  sketched.ok && handLoaded,
  "the sketch theme draws Korean in the hand-drawn Hangul face",
);
await page.screenshot({ path: path.join(dist, "..", "embed-sketch.png") });

// the font picker offers every Hangul face
await page.mouse.click(600, 400);
await page.keyboard.press("ControlOrMeta+a");
await page.click("[data-testid=font-family-show-fonts]");
await page
  .waitForSelector(".dropdown-menu.fonts", { timeout: 5000 })
  .catch(() => {});
const listed = await page.evaluate(
  () => document.querySelector(".dropdown-menu.fonts")?.textContent ?? "",
);
const faces = [
  "Pretendard",
  "Gaegu",
  "Nanum Pen Script",
  "Gowun Dodum",
  "Jua",
  "D2Coding",
];
check(
  faces.every((face) => listed.includes(face)),
  `the font picker lists the Hangul faces (${listed
    .replace(/\s+/g, " ")
    .slice(0, 200)})`,
);
await page.screenshot({ path: path.join(dist, "..", "embed-fonts.png") });
await page.keyboard.press("Escape");

await page.screenshot({ path: path.join(dist, "..", "embed-e2e.png") });
check(
  violations.length === 0,
  `no policy violation${violations.length ? `: ${violations[0]}` : ""}`,
);

await browser.close();
server.close();
