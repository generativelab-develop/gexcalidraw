# Canvas ops reference — what you can draw, and how

The canvas engine (this agent canvas) draws from **ops**: JSON objects that name things by ids you choose. This file is the whole vocabulary and a recipe for each kind of drawing people make on a whiteboard. The same ops go through `cerebrate canvas apply` (Cerebrate's 기획 screen) and `gexcal apply` (the standalone canvas).

Pick the form from what the drawing is FOR, then compose. Everything below can be mixed on one canvas: a sequence diagram beside a table, cards inside a slide, a wireframe flow with notes.

## 1. Which form for which drawing

| The owner wants | Use | Recipe |
| --- | --- | --- |
| system / software architecture, service map | nodes with `kind`, groups for boundaries | §5.1 |
| flowchart, process, decision flow | nodes (`decision` = diamond), labelled edges, or Mermaid `flowchart` | §5.2 |
| data flow diagram (DFD) | `process` ellipses, `store` / `external` nodes, labelled edges | §5.3 |
| sequence diagram (who calls whom, in order) | `sequence` block, or Mermaid `sequenceDiagram` | §5.4 |
| UML class diagram | card nodes (`fields`) + UML arrowheads, or Mermaid `classDiagram` | §5.5 |
| ER / database schema | card nodes + crow's-foot heads, or Mermaid `erDiagram` | §5.6 |
| state machine, game states, lifecycle | nodes + edges, or Mermaid `stateDiagram-v2` | §5.7 |
| mind map | `layout: radial`, or Mermaid `mindmap` | §5.8 |
| org chart, hierarchy, decision tree | `layout: tree` | §5.9 |
| Gantt chart, schedule, roadmap | `timeline` block, or Mermaid `gantt` | §5.10 |
| SWOT, 2x2 with lists | `table` block, 2x2 coloured cells | §5.11 |
| Lean Canvas, Business Model Canvas | `table` block with `span` / `rowspan` | §5.12 |
| competitor analysis | `quadrant` block (positioning) + `table` (feature comparison) | §5.13 |
| prioritisation (impact/effort, Eisenhower) | `quadrant` block, or Mermaid `quadrantChart` | §5.13 |
| user persona, profile card, interview scorecard | card nodes with sections, `layout: grid` | §5.14 |
| wireframe, screen flow, user flow | `wireframe` blocks + edges between screens | §5.15 |
| brainstorm, affinity map, retrospective board | `sticky` nodes in groups, `layout: grid`, theme `sketch` | §5.16 |
| presentation, slides | groups with `slide: true` in a `grid` | §5.17 |
| game design: level map, loop, economy | state/flow + `sketch` block for a map | §5.18 |
| an icon, an illustration, anything none of the above draws | `sketch` block (shapes in your own coordinates) | §4.6 |
| headings, captions, paragraphs | `text` nodes with `size` | §2.1 |

## 2. Graph ops

Ids match `[A-Za-z0-9][A-Za-z0-9_.:>-]*` (ASCII). Re-sending an op with an existing id UPDATES it; `null` clears an optional field. A batch is all or nothing: an op that cannot be drawn is refused with its number and the reason, and nothing changes.

### 2.1 node

```json
{ "op": "node", "id": "api", "label": "API", "kind": "service", "group": "cp" }
```

| field | values |
| --- | --- |
| `label` | text; `\n` for a line break (required for a new node) |
| `shape` | `rect` (default), `ellipse`, `diamond`, `sticky` (a sticky note that takes part in layout), `text` (no border: a heading, caption or paragraph) |
| `kind` | picks colour and shape when you name neither: `service` `api` (blue) · `ui` `client` (violet) · `user` `actor` (violet ellipse) · `store` `db` `file` (yellow) · `queue` `topic` (orange) · `job` `worker` `process` (green) · `external` (gray) · `decision` (pink diamond) · `config` (teal) |
| `color` | `blue` `green` `red` `yellow` `orange` `violet` `pink` `teal` `gray` `black`, or `#rrggbb` |
| `size` | `s` `m` (default) `l` `xl` — the label's font size; use `l`/`xl` text nodes for titles |
| `fields` | turns the node into a **card**: the label is the title, then sections under rules. A list of lines is one section; a list of lists is several: `[["+id: UUID", "+name"], ["+login()"]]` (at most 6 sections) |
| `group` | the group (or frame) it belongs to |
| `source` | a file path it stands for (shown in describe) |

`sticky` and `text` nodes take no `fields`.

### 2.2 edge

```json
{ "op": "edge", "from": "api", "to": "db", "label": "SQL", "line": "dashed" }
```

| field | values |
| --- | --- |
| `from`, `to` | a node id or a **block** id (a screen, a table) |
| `label` | what flows |
| `line` | `solid`, `dashed` (asynchronous, optional, return), `dotted` |
| `head` | the arrowhead at `to`; default `arrow` |
| `tail` | the arrowhead at `from`; default `none` |
| `color` | as for nodes |
| `id` | needed only for a second edge between the same pair (default `from->to`) |

Arrowheads: `none` `arrow` `bar` `circle` `circle_outline` `triangle` `triangle_outline` `diamond` `diamond_outline` `cardinality_one` `cardinality_many` `cardinality_one_or_many` `cardinality_exactly_one` `cardinality_zero_or_one` `cardinality_zero_or_many`.

- a plain line (mind map, org chart, association): `"head": "none"`
- both directions: `"tail": "arrow"`
- UML inheritance: `"head": "triangle_outline"` from child to parent
- UML composition / aggregation: `"tail": "diamond"` / `"diamond_outline"` on the whole's side
- ER: `"tail": "cardinality_exactly_one", "head": "cardinality_zero_or_many"`

### 2.3 group

```json
{ "op": "group", "id": "cp", "label": "Control plane", "parent": "platform" }
```

| field | values |
| --- | --- |
| `label` | the name drawn in its corner (required for a new group) |
| `parent` | nest it in another group |
| `color` | its tint |
| `frame` | `true` draws an Excalidraw **frame** (named box that clips and moves its contents) instead of a dashed box: a screen, a board, a section |
| `slide` | `true` makes it a frame at least 960x540 (16:9): a presentation slide |
| `layout` | how THIS group arranges its members (§3); default: its parent's |
| `columns` | for `layout: grid`, members per row |

Frames do not nest inside frames, and a wireframe block (itself a frame) cannot go inside one.

### 2.4 note

```json
{
  "op": "note",
  "on": "queue",
  "text": "survives a daemon crash",
  "color": "yellow"
}
```

A sticky note placed beside its target (a node, edge, group or block) with a dashed link, never on top of anything. Without `on` it goes to a column on the right. Use notes for what boxes cannot say: a decision and why, an invariant, a risk, an open question. Colours: `yellow` `blue` `green` `pink` `orange` `violet` `gray`.

### 2.5 remove, clear, layout, meta

- `{ "op": "remove", "id": "x" }` — a node or block takes its edges with it; a group's members move to its parent.
- `{ "op": "clear" }` — removes everything YOU drew; never what the owner drew.
- `{ "op": "layout", "direction": "DOWN", "algorithm": "tree", "columns": 3, "keepPinned": true }` — re-lays out everything now; every field optional.
- `{ "op": "meta", "theme": "sketch", "direction": "RIGHT", "layout": "grid", "columns": 3 }` — sets the defaults without laying out now.

`theme`: `clean` (Nunito / Pretendard, straight lines) or `sketch` (hand-drawn lines, Excalifont / Gaegu). `direction`: `RIGHT` `DOWN` `LEFT` `UP`.

## 3. Layout

You never give coordinates for graph things; the canvas places them. Each container (the whole drawing, or a group) arranges its own members:

| `layout` | arranges | good for |
| --- | --- | --- |
| `layered` (default) | in ranks along `direction`, edges routed around boxes | architecture, flows, UML, ER, states |
| `tree` | a hierarchy, parent above children | org charts, decision trees, sitemaps |
| `radial` | the first root in the middle, branches around it, straight lines | mind maps |
| `grid` | rows and columns in the order you made them (`columns` per row) | boards, card walls, personas, slide decks, several blocks side by side |

A group with no `layout` of its own follows its parent, except that a group inside a grid whose members are joined by an edge is laid out `layered` (so a diagram on a slide is a diagram). An edge between things that were laid out by different containers is drawn as an elbow arrow the editor routes.

Once the owner has moved something by hand, new things are placed around it and nothing they placed moves until you send `{"op":"layout"}` (or `{"op":"layout","keepPinned":true}` to keep their boxes where they are).

## 4. Blocks

A block is one figure described as data. The canvas draws it as one unit; the layout places it like a node; edges may connect to it; notes may attach to it. To change a block, **resend the whole op with the same id** (describe prints each block's current op). Every block takes an optional `group`.

### 4.1 table

```json
{
  "op": "table",
  "id": "cmp",
  "title": "기능 비교",
  "columns": ["", "우리", "A사"],
  "rowHeaders": true,
  "rows": [
    ["가격", "₩9,000", "₩20,000"],
    ["실시간 협업", "✓", "—"]
  ]
}
```

- `columns`: the header row (optional). `rowHeaders: true` makes each row's first cell a header.
- `rows`: lists of cells. A cell is text, or `{ "title", "text", "items": [...], "color", "span", "rowspan", "align" }` — `title` in the cell's colour, `items` as bullets, `span`/`rowspan` like HTML.
- `color`: the header colour (default blue). `maxColumnWidth` (default 280) — longer text wraps.

### 4.2 quadrant

```json
{
  "op": "quadrant",
  "id": "prio",
  "title": "우선순위",
  "x": ["노력 적음", "노력 많음"],
  "y": ["영향 작음", "영향 큼"],
  "quadrants": ["계획", "바로 하기", "버리기", "나중에"],
  "items": [{ "label": "검색 개편", "x": 0.3, "y": 0.8, "color": "violet" }]
}
```

`x`/`y` are `[low, high]` axis labels. `quadrants` follow Mermaid's numbering: 1 top-right, 2 top-left, 3 bottom-left, 4 bottom-right. Each item's `x`, `y` is between 0 and 1.

### 4.3 sequence

```json
{
  "op": "sequence",
  "id": "login",
  "title": "로그인",
  "autonumber": true,
  "participants": [
    { "id": "u", "label": "사용자", "kind": "actor" },
    "api",
    "db"
  ],
  "items": [
    { "from": "u", "to": "api", "label": "POST /login" },
    { "from": "api", "to": "db", "label": "SELECT user" },
    {
      "fragment": "alt",
      "label": "비밀번호 일치",
      "items": [{ "from": "api", "to": "u", "label": "200", "line": "dashed" }],
      "else": [
        {
          "label": "불일치",
          "items": [
            { "from": "api", "to": "u", "label": "401", "line": "dashed" }
          ]
        }
      ]
    },
    { "from": "api", "to": "api", "label": "감사 로그" },
    { "note": "모든 구간 TLS", "over": ["u", "api"] }
  ]
}
```

- participants: an id, or `{ id, label, kind, color }` (`kind: actor` draws an ellipse).
- a message: `{ from, to, label, line, head }` — `line: dashed` for a reply; `from == to` is a self call.
- a note: `{ note, over: id | [id, id], color }`.
- a fragment: `{ fragment: loop | alt | opt | par | critical | break | rect, label, items, else: [{ label, items }] }`, nesting allowed.

### 4.4 timeline (Gantt, roadmap)

```json
{
  "op": "timeline",
  "id": "q4",
  "title": "4분기 계획",
  "today": "2026-10-21",
  "todayLabel": "오늘",
  "tasks": [
    {
      "id": "design",
      "label": "화면 설계",
      "section": "설계",
      "start": "2026-10-01",
      "days": 10,
      "done": true
    },
    {
      "id": "api",
      "label": "API",
      "section": "개발",
      "after": "design",
      "days": 14,
      "progress": 0.4
    },
    {
      "label": "QA",
      "section": "개발",
      "start": "2026-11-01",
      "end": "2026-11-07",
      "color": "red"
    },
    { "label": "출시", "start": "2026-11-20", "milestone": true }
  ]
}
```

- `start`: a date `YYYY-MM-DD` (or a plain number for abstract steps such as sprints, with `stepLabel: "S"`); `after`: an earlier task's `id` instead.
- length: `end` (the last day, included) or `days`; `milestone: true` is a diamond.
- `section` groups rows under a coloured band; `done`, `progress` (0–1), `color`.
- `unit`: `day` `week` `month` `quarter` for the axis (chosen from the span when absent); `today` draws a red line.

### 4.5 wireframe

```json
{
  "op": "wireframe",
  "id": "login",
  "label": "로그인",
  "device": "mobile",
  "items": [
    { "type": "header", "label": "Cerebrate", "items": ["도움말"] },
    { "type": "title", "label": "다시 오신 걸 환영해요" },
    { "type": "input", "label": "이메일", "text": "you@example.com" },
    { "type": "checkbox", "label": "로그인 유지", "checked": true },
    {
      "type": "row",
      "items": [
        { "type": "button", "label": "로그인" },
        { "type": "button", "label": "가입", "primary": false }
      ]
    },
    { "type": "tabbar", "items": ["홈", "검색", "나"] }
  ]
}
```

A screen drawn as a named frame. `device`: `mobile` (390 wide, default), `tablet`, `desktop`, `browser` (with a window bar). Widgets stack top to bottom; `row` puts its `items` side by side.

| type | fields |
| --- | --- |
| `header` | `label` (title), `items` (menu words on the right) |
| `title`, `text`, `link` | `label` or `text` |
| `button` | `label`, `primary: false` for an outlined one |
| `input`, `textarea`, `search`, `select` | `label` (above), `text` (placeholder) |
| `checkbox`, `radio`, `toggle` | `label`, `checked` |
| `image` | `label` (caption), `height`: `s` `m` `l` |
| `avatar` | `label` |
| `card` | `label` (title), `text` |
| `list` | `items` (rows with a chevron) |
| `tabs`, `chips` | `items` (the first is selected) |
| `tabbar` | `items` — pinned to the bottom of the screen |
| `table` | `items`: rows of cells, the first row is the header |
| `progress` | `label`, `value` (0–1) |
| `divider`, `spacer` | `spacer` takes `height`: `s` `m` `l` |
| `row` | `items`: widgets side by side |

A user flow is screens plus edges: `{"op":"edge","from":"login","to":"home","label":"로그인 성공"}`.

### 4.6 sketch (free drawing)

When nothing above fits, draw shapes yourself in the block's own coordinates (any origin; the block starts at the drawing's top-left corner and is placed by the layout like a node).

```json
{
  "op": "sketch",
  "id": "server",
  "label": "서버 한 대",
  "elements": [
    {
      "type": "rect",
      "x": 0,
      "y": 0,
      "w": 120,
      "h": 160,
      "color": "gray",
      "fill": true,
      "rounded": true
    },
    {
      "type": "line",
      "points": [
        [10, 40],
        [110, 40]
      ]
    },
    {
      "type": "ellipse",
      "x": 92,
      "y": 18,
      "w": 10,
      "h": 10,
      "color": "green",
      "fill": "green"
    },
    {
      "type": "arrow",
      "points": [
        [130, 80],
        [200, 80],
        [200, 20]
      ],
      "line": "dashed"
    },
    {
      "type": "text",
      "x": 160,
      "y": 90,
      "text": "heartbeat",
      "size": "s",
      "align": "center"
    }
  ]
}
```

| type | fields |
| --- | --- |
| `rect`, `ellipse`, `diamond` | `x`, `y`, `w`, `h`; `text` (a centred label), `fill` (`true` = the colour's tint, a colour name, or `"none"`), `fillStyle` (`solid` `hachure` `cross-hatch`), `rounded` |
| `line`, `arrow` | `points` (two or more `[x, y]`), `head`, `tail` |
| `text` | `x`, `y`, `text`, `align` (`left` from x, `center` around x, `right` up to x) |
| all | `color`, `line` (`solid` `dashed` `dotted`), `width` (stroke 1–8), `size` (`s` `m` `l` `xl` or a number), `opacity` (0–100) |

Keep a sketch to what the drawing needs (up to 400 elements). Edges and notes attach to the sketch as a whole.

## 5. Recipes

Each recipe is a starting point; adapt the words. Long batches go in a file (`--ops-file`).

### 5.1 Software architecture

Group by boundary (process, service, network, team); `kind` for what each box is; label edges with what flows; dashed for asynchronous.

```json
[
  { "op": "group", "id": "edge", "label": "Edge" },
  { "op": "group", "id": "core", "label": "Core services" },
  { "op": "node", "id": "web", "label": "Web app", "kind": "ui" },
  {
    "op": "node",
    "id": "gw",
    "label": "API gateway",
    "kind": "api",
    "group": "edge"
  },
  {
    "op": "node",
    "id": "orders",
    "label": "orders",
    "kind": "service",
    "group": "core"
  },
  {
    "op": "node",
    "id": "bus",
    "label": "events",
    "kind": "topic",
    "group": "core"
  },
  { "op": "node", "id": "pg", "label": "PostgreSQL", "kind": "db" },
  { "op": "edge", "from": "web", "to": "gw", "label": "HTTPS" },
  { "op": "edge", "from": "gw", "to": "orders" },
  { "op": "edge", "from": "orders", "to": "pg", "label": "SQL" },
  {
    "op": "edge",
    "from": "orders",
    "to": "bus",
    "label": "OrderPlaced",
    "line": "dashed"
  }
]
```

### 5.2 Flowchart

Start/end as ellipses, steps as rects, questions as `decision`; label the branches. `direction: DOWN` reads best for long flows. Mermaid `flowchart TD` does the same in one line per edge.

### 5.3 Data flow diagram

Processes are `kind: process` with `shape: ellipse`; data stores `kind: store`; outside parties `kind: external`; every edge names the data.

### 5.4 Sequence diagram

The `sequence` block (§4.3). Replies `dashed`; use `alt`/`loop` fragments for branches and retries; `autonumber` when the steps are discussed by number.

### 5.5 UML class diagram

```json
[
  {
    "op": "node",
    "id": "animal",
    "label": "«abstract»\nAnimal",
    "color": "blue",
    "fields": [["+name: String"], ["+eat(food) void"]]
  },
  {
    "op": "node",
    "id": "dog",
    "label": "Dog",
    "color": "blue",
    "fields": [[], ["+bark() void"]]
  },
  { "op": "edge", "from": "dog", "to": "animal", "head": "triangle_outline" },
  {
    "op": "edge",
    "from": "dog",
    "to": "leg",
    "tail": "diamond",
    "head": "none",
    "label": "4"
  },
  { "op": "node", "id": "leg", "label": "Leg", "color": "blue" },
  { "op": "layout", "direction": "UP" }
]
```

### 5.6 ER diagram / database schema

```json
[
  {
    "op": "node",
    "id": "customer",
    "label": "customer",
    "color": "yellow",
    "fields": [["id: uuid PK", "email: text UK"]]
  },
  {
    "op": "node",
    "id": "order",
    "label": "order",
    "color": "yellow",
    "fields": [["id: uuid PK", "customer_id: uuid FK"]]
  },
  {
    "op": "edge",
    "from": "customer",
    "to": "order",
    "label": "places",
    "tail": "cardinality_exactly_one",
    "head": "cardinality_zero_or_many"
  }
]
```

### 5.7 State machine

States are rounded rects; start and end small `ellipse`s (`"label":"●"`, `"size":"s"`, `"width":40,"height":40`); transitions labelled with the event. A composite state is a group. Mermaid `stateDiagram-v2` produces exactly this.

### 5.8 Mind map

```json
[
  { "op": "meta", "layout": "radial" },
  {
    "op": "node",
    "id": "root",
    "label": "출시 준비",
    "shape": "ellipse",
    "size": "l",
    "color": "violet"
  },
  { "op": "node", "id": "mkt", "label": "마케팅", "color": "blue" },
  {
    "op": "edge",
    "from": "root",
    "to": "mkt",
    "head": "none",
    "color": "blue"
  },
  {
    "op": "node",
    "id": "mkt1",
    "label": "블로그 글",
    "size": "s",
    "color": "blue"
  },
  {
    "op": "edge",
    "from": "mkt",
    "to": "mkt1",
    "head": "none",
    "color": "blue"
  },
  { "op": "node", "id": "dev", "label": "개발", "color": "green" },
  {
    "op": "edge",
    "from": "root",
    "to": "dev",
    "head": "none",
    "color": "green"
  }
]
```

One colour per first-level branch, inherited by its children; `head: none`.

### 5.9 Org chart / hierarchy / decision tree

`{"op":"meta","layout":"tree","direction":"DOWN"}`, then nodes and parent→child edges with `head: none`. For a decision tree, label the edges with the answer.

### 5.10 Gantt chart / roadmap

The `timeline` block (§4.4): sections per team or phase, `after` for dependencies, `today` for where we are, `milestone` for launches. A roadmap is the same with `unit: "quarter"` and long bars.

### 5.11 SWOT

```json
{
  "op": "table",
  "id": "swot",
  "title": "SWOT — 제품명",
  "rows": [
    [
      { "title": "Strengths 강점", "items": ["…"], "color": "green" },
      { "title": "Weaknesses 약점", "items": ["…"], "color": "orange" }
    ],
    [
      { "title": "Opportunities 기회", "items": ["…"], "color": "blue" },
      { "title": "Threats 위협", "items": ["…"], "color": "red" }
    ]
  ]
}
```

### 5.12 Lean Canvas / Business Model Canvas

A 10-column table: the top two rows are five cells of `span: 2`, with Problem, Unique Value Proposition and Customer Segments `rowspan: 2`; the bottom row is Cost Structure and Revenue Streams, `span: 5` each. `maxColumnWidth: 130` keeps it compact.

```json
{
  "op": "table",
  "id": "lean",
  "title": "Lean Canvas",
  "maxColumnWidth": 130,
  "rows": [
    [
      { "title": "Problem", "text": "…", "span": 2, "rowspan": 2 },
      { "title": "Solution", "text": "…", "span": 2 },
      {
        "title": "Unique Value Proposition",
        "text": "…",
        "span": 2,
        "rowspan": 2,
        "color": "violet"
      },
      { "title": "Unfair Advantage", "text": "…", "span": 2 },
      { "title": "Customer Segments", "text": "…", "span": 2, "rowspan": 2 }
    ],
    [
      { "title": "Key Metrics", "text": "…", "span": 2 },
      { "title": "Channels", "text": "…", "span": 2 }
    ],
    [
      { "title": "Cost Structure", "text": "…", "span": 5 },
      { "title": "Revenue Streams", "text": "…", "span": 5 }
    ]
  ]
}
```

The Business Model Canvas is the same idea with its nine blocks (Key Partners, Key Activities, Key Resources, Value Propositions, Customer Relationships, Channels, Customer Segments, Cost Structure, Revenue Streams).

### 5.13 Competitor analysis / prioritisation

`{"op":"meta","layout":"grid","columns":1}` then a `quadrant` (positioning: two axes that matter to buyers, us in a distinct colour) and a `table` (features as rows, competitors as columns, `rowHeaders: true`, ✓ and — in the cells). For impact/effort or Eisenhower, the `quadrant` alone.

### 5.14 Personas, profiles, scorecards

Card nodes in a grid: the label is name · role, sections are goals / tools, pains / a quote. An interview scorecard is a `table` (criteria × rating × evidence).

```json
[
  { "op": "meta", "layout": "grid", "columns": 2 },
  {
    "op": "node",
    "id": "p1",
    "label": "김지은 · PM, 32",
    "color": "violet",
    "fields": [
      ["목표: …", "도구: …"],
      ["불편: …", "인용: \"…\""]
    ]
  }
]
```

### 5.15 Wireframes and user flows

One `wireframe` block per screen, edges between screens labelled with the action that moves the user, notes for open questions on a screen. Use the `sketch` theme when the owner wants it to look unfinished on purpose.

### 5.16 Brainstorm / affinity map / retrospective

```json
[
  { "op": "meta", "layout": "grid", "columns": 3, "theme": "sketch" },
  {
    "op": "group",
    "id": "good",
    "label": "좋았던 점",
    "color": "green",
    "layout": "grid",
    "columns": 2
  },
  {
    "op": "group",
    "id": "bad",
    "label": "아쉬운 점",
    "color": "red",
    "layout": "grid",
    "columns": 2
  },
  {
    "op": "group",
    "id": "try",
    "label": "해볼 것",
    "color": "blue",
    "layout": "grid",
    "columns": 2
  },
  {
    "op": "node",
    "id": "g1",
    "label": "배포가 빨라졌다",
    "shape": "sticky",
    "group": "good",
    "color": "green"
  }
]
```

One group per cluster or column, `sticky` nodes inside, the note colour per group.

### 5.17 Presentation slides

```json
[
  { "op": "meta", "layout": "grid", "columns": 3 },
  {
    "op": "group",
    "id": "s1",
    "label": "1. 문제",
    "slide": true,
    "layout": "grid",
    "columns": 1
  },
  {
    "op": "node",
    "id": "s1t",
    "label": "업무 맥락이 흩어져 있다",
    "shape": "text",
    "size": "xl",
    "group": "s1"
  },
  {
    "op": "node",
    "id": "s1b",
    "label": "• 채널마다 다른 기록\n• 같은 질문의 반복",
    "shape": "text",
    "size": "l",
    "group": "s1"
  },
  { "op": "group", "id": "s2", "label": "2. 해결", "slide": true },
  { "op": "node", "id": "a", "label": "요청", "kind": "user", "group": "s2" },
  {
    "op": "node",
    "id": "b",
    "label": "허브",
    "kind": "service",
    "group": "s2"
  },
  { "op": "edge", "from": "a", "to": "b" }
]
```

Slides are frames in reading order; a slide holding a diagram lays it out as a diagram. `export --ids s2` exports one slide.

### 5.18 Game design

A core loop is a cycle of nodes (`layout` `radial` or a flow); game states are a state machine (§5.7); an economy is a DFD of resources (§5.3); a level map is a `sketch` block of rooms (rects) and paths (lines) with notes for encounters.

## 6. Mermaid

`mermaid` takes these kinds and turns them into the ops above, so you can edit the result by id afterwards:

| Mermaid | becomes |
| --- | --- |
| `flowchart` / `graph` | nodes, edges, groups (subgraphs) |
| `sequenceDiagram` | one `sequence` block (participants, actors, notes, loop/alt/opt/par/critical/break) |
| `classDiagram` | card nodes (attributes, then methods) and UML arrows; `namespace` becomes a group |
| `erDiagram` | card nodes (attributes) and crow's-foot edges |
| `stateDiagram-v2` | states, start/end dots, composite states as groups, choice as a diamond |
| `mindmap` | a radial tree, one colour per branch |
| `gantt` | one `timeline` block (`dateFormat YYYY-MM-DD` only) |
| `quadrantChart` | one `quadrant` block |

Ids come from the Mermaid names (a name with Hangul gets an ASCII id with a short tag); `--prefix` namespaces them; `--print` shows the ops without drawing.

## 7. Making it read well

- Ten to twenty-five boxes per diagram; split a bigger one into groups, frames or several plans.
- Colour means something: one colour per layer, team or branch, and a legend (a `text` node or a note) when it is not obvious.
- Titles: a `text` node with `size: "xl"`, or the block's `title`.
- Korean text measures and draws in the matching Hangul face in both themes; write labels in the owner's language.
- After every batch read the issues, `export`, and look at the image before you report.
