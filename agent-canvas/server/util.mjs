import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const emptyScene = () =>
  `${JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "gexcal",
      elements: [],
      appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
      files: {},
    },
    null,
    2,
  )}\n`;

export const stateDir = () =>
  process.env.GEXCAL_HOME || path.join(os.homedir(), ".gexcal");

export const stateFile = () => path.join(stateDir(), "server.json");

/** Where earlier versions of one scene file are kept. */
export const revisionsDir = (file) => {
  const abs = path.resolve(file);
  const tag = crypto
    .createHash("sha256")
    .update(abs)
    .digest("hex")
    .slice(0, 12);
  return path.join(
    stateDir(),
    "revisions",
    `${path.basename(abs, ".excalidraw")}-${tag}`,
  );
};

export const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
};

export const writeState = (state) => {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
};

export const clearState = (pid) => {
  const state = readState();
  if (state && (!pid || state.pid === pid)) {
    fs.rmSync(stateFile(), { force: true });
  }
};

const isExecutable = (p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const playwrightChromes = () => {
  const roots = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ];
  const found = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries
      .filter((e) => /^chromium-\d+$/.test(e))
      .sort()
      .reverse()) {
      found.push(
        path.join(
          root,
          entry,
          "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        ),
        path.join(
          root,
          entry,
          "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
        ),
        path.join(
          root,
          entry,
          "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ),
        path.join(
          root,
          entry,
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ),
        path.join(root, entry, "chrome-linux/chrome"),
        path.join(root, entry, "chrome-linux64/chrome"),
      );
    }
  }
  return found;
};

export const findChrome = () => {
  const candidates = [
    process.env.GEXCAL_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...playwrightChromes(),
  ].filter(Boolean);
  return candidates.find(isExecutable) ?? null;
};

export const spawnHeadless = (chrome, url) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gexcal-chrome-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1600,1000",
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: "ignore" },
  );
  child.on("exit", () => {
    fs.rmSync(profile, { recursive: true, force: true });
  });
  return child;
};
