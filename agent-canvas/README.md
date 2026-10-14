# agent-canvas (`gexcal`)

A live Excalidraw canvas that coding agents draw on through a CLI.

The agent names things (`node daemon "cerebrated" --group cp`, `edge portal daemon`); the canvas measures labels with Excalidraw's own text code, lays the graph out with [ELK](https://eclipse.dev/elk/), routes arrows around boxes and writes the `.excalidraw` file. A person watching the canvas sees every command land at once and can edit alongside: boxes they move stay put, text they write is reported back to the agent.

```
node agent-canvas/bin/gexcal.mjs open docs/arch.excalidraw   # opens the browser
node agent-canvas/bin/gexcal.mjs node daemon "cerebrated" --kind service
node agent-canvas/bin/gexcal.mjs node portal "Portal" --kind ui
node agent-canvas/bin/gexcal.mjs edge portal daemon "action.start"
node agent-canvas/bin/gexcal.mjs note "queue survives a crash" --on daemon
node agent-canvas/bin/gexcal.mjs describe
node agent-canvas/bin/gexcal.mjs export arch.png
```

`gexcal help` lists every command. **Agents: read [`skills/gexcal/SKILL.md`](skills/gexcal/SKILL.md)**; it is written for you and can be installed as a Claude Code skill (`ln -s "$PWD/agent-canvas/skills/gexcal" ~/.claude/skills/gexcal`).

## How it works

```
gexcal CLI ──HTTP (loopback, token)──▶ server (Vite + bridge) ──Vite HMR socket──▶ canvas page
                                            │                                     (Excalidraw)
                                            └── reads / writes ── scene.excalidraw ◀── saves ──┘
```

- **The file is the source of truth.** The server reads it at start, writes every change the canvas sends, keeps the previous version under `~/.gexcal/revisions/` (`gexcal revisions`, `gexcal restore`), and pushes an edit made to the file by anything else to every open canvas.
- **The canvas page is the engine.** Agent requests run inside a real Excalidraw page, so measurement, arrow binding and export are exactly the editor's. When no browser tab is open, the server starts a headless Chrome/Chromium as the engine (`GEXCAL_CHROME` overrides the binary); when a person opens the canvas, their tab takes over.
- **The model lives in the scene.** Every element the agent owns carries `customData.gx` (its id, role, kind, source path, where the layout last put it), so the agent's view is read back from the scene each time, including what a person changed. Elements without it are the person's and are never touched.
- **Placement**: ELK `layered` with compound groups and orthogonal routing while nothing is hand-placed; afterwards only new elements are placed, and arrows touching hand-placed boxes become elbow arrows routed by the editor (`updateElbowArrowPoints`), which keep re-routing while a person drags. Notes are placed afterwards, clear of boxes, arrows and arrow labels.

State lives in `~/.gexcal/` (`GEXCAL_HOME` overrides): `server.json` (port, pid, API token, mode 0600), `server.log`, `revisions/`.

## Developing

```
yarn vitest run agent-canvas      # engine unit tests
yarn test:typecheck               # includes agent-canvas/src
GEXCAL_DEV=1 node agent-canvas/server/serve.mjs --file /tmp/x.excalidraw
```

Without `GEXCAL_DEV=1` the server does not watch sources, so an open canvas is never reloaded under an agent's feet.

## Embedding the canvas

`yarn --cwd agent-canvas build:embed` builds `src/embed.tsx` into `agent-canvas/dist-embed/`: `plan-canvas.js` (one ES module, React and the Latin fonts included, no dynamic import, no network reference), `plan-canvas.css` and `fonts/` (the Hangul faces, below). A host page serves the directory from its own origin and calls

```js
const canvas = await mountPlanCanvas(element, { theme, langCode: "ko-KR", onSave });
canvas.load(sceneText, { fresh: true });     // a file just opened
await canvas.request("apply", { ops });      // { ok, result } or { ok: false, error }
```

The host owns the file: it loads scenes in, writes what `onSave` hands it, and relays agent requests (`apply`, `mermaid`, `describe`, `export`, `fit`, `undo`) to `request`. The same `CanvasSession` (`src/session.ts`) runs behind the dev server's page, so both behave alike. The build leaves out the hand-drawn CJK font (Xiaolai, ~13 MB) and glyph subsetting, whose WebAssembly a host without `wasm-unsafe-eval` refuses, so an SVG export carries each font face whole. `node agent-canvas/test/embed.e2e.mjs` checks the build under a strict same-origin Content-Security-Policy.

### Korean

The fork adds six faces that draw Hangul. All six are in the font picker; four are also the fallback of upstream families in the same style, so Korean keeps the look of the text around it (`HANGUL_FALLBACK_FONT`, packages/common/src/constants.ts):

| Face | Style | Falls back for | Licence |
| --- | --- | --- | --- |
| Gaegu | hand-drawn (marker) | Excalifont, Virgil | OFL 1.1 |
| Nanum Pen Script | hand-drawn (pen) | — | OFL 1.1 |
| Pretendard | plain | Nunito, Helvetica, Liberation Sans, Assistant | OFL 1.1 |
| Gowun Dodum | plain (soft) | — | OFL 1.1 |
| Jua | heading | Lilita One | OFL 1.1 |
| D2Coding | code | Comic Shanns, Cascadia | OFL 1.1 |

Each lives in `packages/excalidraw/fonts/<Face>/` as one woff2 with its `OFL.txt`. Gaegu and Jua cover the 2,350 syllables of KS X 1001; the others all 11,172. The embed build writes them to `dist-embed/fonts/` beside the module rather than into it: the browser fetches one only when its characters are on the canvas.
