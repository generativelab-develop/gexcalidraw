/* eslint-disable no-console */
// End-to-end: a "person's" browser tab is open on the canvas while the agent
// draws through the CLI; the person moves a box and writes a text; the agent
// keeps the person's placement and reads the person's text.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import os from "node:os";
import { fileURLToPath } from "node:url";

import { findChrome } from "../server/util.mjs";

// Usage: node agent-canvas/test/live.e2e.mjs
// Needs playwright-core, which the workspace does not install:
//   npm i --no-save playwright-core   (or put it anywhere on NODE_PATH)
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log(
    "SKIP live.e2e: playwright-core is not installed (npm i --no-save playwright-core)",
  );
  process.exit(0);
}

const S = fs.mkdtempSync(path.join(os.tmpdir(), "gexcal-e2e-"));
const GEX = fileURLToPath(new URL("../bin/gexcal.mjs", import.meta.url));
const file = path.join(S, "live.excalidraw");
fs.rmSync(file, { force: true });
const env = { ...process.env, GEXCAL_HOME: path.join(S, "gx") };
const gx = (...args) =>
  execFileSync("node", [GEX, ...args], { env, encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) {
    process.exitCode = 1;
  }
};

console.log(gx("open", file, "--no-browser"));
const { url } = JSON.parse(
  fs.readFileSync(path.join(S, "gx/server.json"), "utf8"),
);

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(url);
await page.waitForFunction(() => window.gexcal?.api, null, { timeout: 60000 });
await sleep(500);
check(
  gx("status").includes("c1") && !gx("status").includes("headless"),
  "the person's tab is the engine",
);

const count = () =>
  page.evaluate(() => window.gexcal.api.getSceneElements().length);

// 1. the agent draws; the tab shows it at once
gx("group", "cp", "Control plane");
gx("node", "daemon", "cerebrated", "--kind", "service", "--group", "cp");
gx("node", "portal", "Portal", "--kind", "ui");
const t0 = Date.now();
console.log(gx("edge", "portal", "daemon", "action.start"));
const shown = await count();
check(
  shown >= 7,
  `tab shows the drawing right away (${shown} elements, ${Date.now() - t0}ms)`,
);
await sleep(800);
await page.screenshot({ path: path.join(S, "live1.png") });

// 2. the person drags the daemon box 260px right, 180px down
const box = await page.evaluate(() => {
  const { api } = window.gexcal;
  const el = api.getSceneElements().find((e) => e.id === "gx-n-daemon");
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = api.getAppState();
  return {
    x: (el.x + el.width / 2 + scrollX) * zoom.value + offsetLeft,
    y: (el.y + el.height / 2 + scrollY) * zoom.value + offsetTop,
    before: [el.x, el.y],
  };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(box.x + 26 * i, box.y + 18 * i);
  await sleep(16);
}
await page.mouse.up();
await sleep(700); // the tab saves after 250ms
const described = gx("describe");
check(
  /daemon .*\[hand-placed\]/.test(described),
  "the agent sees the moved box as hand-placed",
);
const arrow = await page.evaluate(() => {
  const a = window.gexcal.api
    .getSceneElements()
    .find((e) => e.id === "gx-e-portal->daemon");
  const orthogonal = a.points
    .slice(1)
    .every((p, i) => p[0] === a.points[i][0] || p[1] === a.points[i][1]);
  return {
    elbowed: a.elbowed,
    orthogonal,
    start: a.startBinding?.elementId,
    end: a.endBinding?.elementId,
  };
});
check(
  arrow.elbowed &&
    arrow.orthogonal &&
    arrow.start === "gx-n-portal" &&
    arrow.end === "gx-n-daemon",
  `the moved box's arrow became an attached, editor-routed elbow arrow (${JSON.stringify(
    arrow,
  )})`,
);
const moved = await page.evaluate(() => {
  const el = window.gexcal.api
    .getSceneElements()
    .find((e) => e.id === "gx-n-daemon");
  return [el.x, el.y];
});

// 3. the agent adds next to it: the person's placement stays
console.log(
  gx("node", "monitor", "monitor", "--kind", "process", "--group", "cp"),
);
console.log(gx("edge", "daemon", "monitor"));
const after = await page.evaluate(() => {
  const el = window.gexcal.api
    .getSceneElements()
    .find((e) => e.id === "gx-n-daemon");
  return [el.x, el.y];
});
check(
  after[0] === moved[0] && after[1] === moved[1],
  `the moved box stayed where the person put it (${after})`,
);

// 4. the person writes a text on the canvas
await page.keyboard.press("Escape");
await page.keyboard.press("t");
await page.mouse.click(200, 650);
await sleep(200);
await page.keyboard.type("auth 쪽도 그려줘");
await page.keyboard.press("Escape");
await sleep(800);
const d2 = gx("describe");
check(d2.includes("auth 쪽도 그려줘"), "the agent reads the person's text");
check(
  fs.readFileSync(file, "utf8").includes("auth 쪽도 그려줘"),
  "the person's text is in the file",
);
await page.screenshot({ path: path.join(S, "live2.png") });
console.log(d2);

// 5. the file changes on disk: the tab follows
const scene = JSON.parse(fs.readFileSync(file, "utf8"));
scene.elements = scene.elements.filter(
  (e) => e.type !== "text" || e.containerId || e.id.startsWith("gx-"),
);
fs.writeFileSync(file, JSON.stringify(scene, null, 2));
await sleep(1200);
const hasText = await page.evaluate(() =>
  window.gexcal.api
    .getSceneElements()
    .some(
      (e) => e.type === "text" && !e.containerId && !e.id.startsWith("gx-"),
    ),
);
check(!hasText, "an edit made to the file reaches the open tab");

// 6. the person drags the group box by its name: the boxes inside follow
const toScreen = (id, dx = 0, dy = 0) =>
  page.evaluate(
    ([id, dx, dy]) => {
      const { api } = window.gexcal;
      const el = api.getSceneElements().find((e) => e.id === id);
      const { scrollX, scrollY, zoom, offsetLeft, offsetTop } =
        api.getAppState();
      return {
        x: (el.x + dx + scrollX) * zoom.value + offsetLeft,
        y: (el.y + dy + scrollY) * zoom.value + offsetTop,
        at: [el.x, el.y],
      };
    },
    [id, dx, dy],
  );
await page.keyboard.press("Escape");
await page.keyboard.press("v");
const label = await toScreen("gx-g-cp-t", 10, 8);
const nodesBefore = await page.evaluate(() =>
  window.gexcal.api
    .getSceneElements()
    .filter((e) => e.id === "gx-n-daemon" || e.id === "gx-n-monitor")
    .map((e) => [e.x, e.y]),
);
await page.mouse.move(label.x, label.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(label.x - 30 * i, label.y + 10 * i);
  await sleep(16);
}
await page.mouse.up();
await sleep(1200);
const nodesAfter = await page.evaluate(() =>
  window.gexcal.api
    .getSceneElements()
    .filter((e) => e.id === "gx-n-daemon" || e.id === "gx-n-monitor")
    .map((e) => [e.x, e.y]),
);
const deltas = nodesAfter.map((p, i) => [
  Math.round(p[0] - nodesBefore[i][0]),
  Math.round(p[1] - nodesBefore[i][1]),
]);
check(
  deltas.every(([dx, dy]) => dx === -300 && dy === 100),
  `the boxes in the group followed it (${JSON.stringify(deltas)})`,
);
const issues = gx("describe").split("issues")[1];
check(/none/.test(issues), `no layout issues after the move: ${issues.trim()}`);
await page.screenshot({ path: path.join(S, "live3.png") });

await browser.close();
gx("stop");
console.log(`artifacts: ${S}`);
