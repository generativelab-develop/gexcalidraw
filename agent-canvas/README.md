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
- **Placement**: ELK `layered` with compound groups and orthogonal routing while nothing is hand-placed; afterwards only new elements are placed. Notes are placed afterwards, clear of boxes, arrows and arrow labels.

State lives in `~/.gexcal/` (`GEXCAL_HOME` overrides): `server.json` (port, pid, API token, mode 0600), `server.log`, `revisions/`.

## Developing

```
yarn vitest run agent-canvas      # engine unit tests
yarn test:typecheck               # includes agent-canvas/src
GEXCAL_DEV=1 node agent-canvas/server/serve.mjs --file /tmp/x.excalidraw
```

Without `GEXCAL_DEV=1` the server does not watch sources, so an open canvas is never reloaded under an agent's feet.
