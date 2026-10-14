# Guidelines

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.
- To draw or annotate a diagram, use the `gexcal` CLI in `agent-canvas/` and follow `agent-canvas/skills/gexcal/SKILL.md`; never hand-write `.excalidraw` JSON.
