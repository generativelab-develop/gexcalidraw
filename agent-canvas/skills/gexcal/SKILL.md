---
name: gexcal
description: Draw and annotate diagrams (architecture, data flow, module maps, sequences of components) on a live Excalidraw canvas through the `gexcal` CLI, and read back what a person changed. Use when asked to draw, sketch, map or diagram a codebase or system, to put notes/memos on a diagram, or to update an existing .excalidraw file.
---

# gexcal: drawing on a live Excalidraw canvas

`gexcal` lets you draw on an Excalidraw canvas by naming things, never by coordinates. You say "there is a node `daemon` in group `cp`, connected to `portal`"; the canvas measures every label with Excalidraw's own text code, lays the graph out with ELK, routes arrows around boxes and writes the `.excalidraw` file. A person watching the canvas sees each command land immediately, and can move boxes or write on the canvas while you work.

Run it as `gexcal <command>` if it is on PATH, otherwise `node <gexcalidraw>/agent-canvas/bin/gexcal.mjs <command>`.

## The loop

1. **Open** the scene: `gexcal open docs/architecture.excalidraw` (creates the file if missing and opens it in the person's browser; add `--no-browser` when nobody is watching, a headless canvas does the work).
2. **Read first** if the file already has content: `gexcal describe`. It lists your nodes/edges/groups/notes by id, everything a person drew by hand, and layout issues.
3. **Draw in small batches** with `gexcal apply` (one JSON batch) or the one-op commands. Every command prints what it drew and any **issues**.
4. **Look at it**: `gexcal export /tmp/view.png`, then open the PNG (Read it). Fix what looks wrong; do not report a diagram you have not looked at.
5. **Annotate** with notes: `gexcal note "why this matters" --on <id>`.

## Ids and ops

Ids are yours and stable (`[A-Za-z0-9][A-Za-z0-9_.:-]*`). Re-sending an op with an existing id UPDATES it; nothing is duplicated. One id names one thing (a node and a group cannot share an id).

```json
{
  "ops": [
    { "op": "group", "id": "cp", "label": "Control plane" },
    { "op": "group", "id": "store", "label": "Stores", "parent": "cp" },
    {
      "op": "node",
      "id": "daemon",
      "label": "cerebrated",
      "kind": "service",
      "group": "cp",
      "source": "go/cmd/cerebrated"
    },
    {
      "op": "node",
      "id": "queue",
      "label": "relay inbox",
      "kind": "queue",
      "group": "store"
    },
    { "op": "edge", "from": "daemon", "to": "queue", "label": "enqueue" },
    { "op": "edge", "from": "queue", "to": "daemon", "line": "dashed" },
    { "op": "note", "on": "queue", "text": "Durable: survives a daemon crash" },
    { "op": "layout", "direction": "DOWN" }
  ]
}
```

| op | fields | notes |
| --- | --- | --- |
| `node` | `id`, `label`, `shape` (rect, ellipse, diamond), `kind`, `group`, `color`, `source`, `at` [x,y] | `kind` picks a colour/shape: service api ui client user actor store db file queue topic job worker process external decision config |
| `edge` | `from`, `to`, `label`, `line` (solid, dashed, dotted), `color`, `id` | default id is `from->to`; give an `id` for a second edge between the same pair |
| `group` | `id`, `label`, `parent`, `color` | groups nest through `parent` |
| `note` | `text`, `on` (a node, edge or group id), `id`, `color`, `at` | a sticky note placed beside its target, linked with a dashed line; ids default to `note-N` |
| `remove` | `id` | removing a node removes its edges; removing a group keeps its members |
| `layout` | `direction` (RIGHT, DOWN, LEFT, UP), `keepPinned` | re-lays out everything; `keepPinned` keeps hand-placed boxes where they are |
| `meta` | `direction`, `theme` (clean, sketch) |  |
| `clear` |  | removes everything you drew; never what a person drew |

Pass `null` to clear an optional field (`"group": null` takes a node out of its group). Colours: blue green red yellow orange violet pink teal gray black or `#rrggbb`.

A batch is all-or-nothing: an op that names a missing node/group, reuses an id for another kind of thing, or misses a required field is REFUSED with the op number and the reason, and nothing is drawn. Fix the op and resend.

## Placement rules (what the canvas does for you)

- While nobody has moved anything by hand, every batch re-lays out the whole diagram, so it stays tidy as it grows.
- Once a person moves a box, that box is **hand-placed**: from then on only new things are placed (next to a connected neighbour, in a free spot) and nothing hand-placed moves. `gexcal layout` re-lays out everything if the person asks for it; `gexcal layout --keep-pinned` tidies the rest only.
- Dragging a group box moves what is inside it.
- Arrows routed by the layout avoid every box. An arrow touching a hand-placed box, or added after something was hand-placed, is an elbow arrow the editor routes, and it re-routes as the box is dragged.
- Notes are placed in the first spot that covers no box, arrow or arrow label; `note-over-edge` and `overlap` say when no such spot was found.

## Reading what the person did

`gexcal describe` lists, under **drawn by hand**, every element you do not own: text, arrows between your nodes, shapes, their own sticky notes. Treat them as the person talking to you on the canvas: a text near a node is usually a request or a correction about that node. Read them before you change the drawing, and do not delete them (`clear` and `remove` cannot).

`[hand-placed]` on a node means the person put it there. Keep it there.

## Issues

`describe` and every draw command report problems the picture has:

- `overlap`: two boxes (or a box and a note) on top of each other
- `edge-through-node`: an arrow runs through a box it does not connect
- `note-over-edge`: a note hides an arrow
- `outside-group` / `foreign-group`: a node sticks out of its group, or sits inside a group it does not belong to
- `edge-unbound`: an arrow is not attached to its box

Resolve them, usually with `gexcal layout` (or `--keep-pinned` when the person has arranged things), before you call the diagram done.

## Drawing a codebase

1. Find the units worth a box: deployables, processes, packages that own a responsibility, stores (DBs, queues, files), external systems. Ten to twenty-five boxes is a readable diagram; more becomes several diagrams.
2. Group by boundary (process, service, layer, repository), not by folder.
3. Put the code path in `source` on each node, so the next agent (and `describe`) can go from the box to the code.
4. Label edges with what flows or the call made (`enqueue`, `HTTP POST /api/x`, `READY file`); dashed for async or eventual, solid for a direct call.
5. Put what is not visible in the boxes into notes: an invariant, a failure mode, a known problem, a decision and why.
6. Export and look before you report.

## Other commands

- `gexcal status` / `gexcal stop`: the server and connected canvases.
- `gexcal fit [id...]`: move the person's view to these elements.
- `gexcal export out.svg|out.png [--ids a,b] [--scale 2] [--dark]`: `--ids` exports only those (a group brings its members).
- `gexcal revisions` / `gexcal restore <revision>`: every write keeps the previous version of the file; restore puts one back and the open canvas follows.
- `gexcal undo`: the canvas's own undo of the last change.

Never edit the `.excalidraw` JSON yourself while the canvas is open: the canvas owns the file, and an edit bypasses measurement, binding and layout.
