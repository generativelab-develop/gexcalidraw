# Canvas ops reference — what you can draw, and how

The canvas engine (this agent canvas) draws from **ops**: JSON objects
that name things by ids you choose. This file is the whole vocabulary and, in
§5, a recipe for every use case Excalidraw documents (plus.excalidraw.com/use-cases
and each case's own page, with the kinds and techniques each page lists). The
same ops go through `cerebrate canvas apply` (Cerebrate's 기획 screen) and
`gexcal apply` (the standalone canvas).

Pick the form from what the drawing is FOR, then compose. Everything can be
mixed on one canvas: a sequence diagram beside the architecture it runs on,
cards inside a slide, notes on a wireframe, a radar chart above a profile.

## 1. Which form for which drawing

| The owner wants | Use | Recipe |
| --- | --- | --- |
| process / decision / data flowchart | nodes with the flowchart symbols (§2.1), labelled edges | §5.1 |
| swimlane flowchart, cross-team process, hiring process | `layout: "lanes"` | §5.1, §5.17 |
| data flow diagram (logical, physical; Gane-Sarson, Yourdon) | `datastore`, `process`/`circle`, `external` | §5.2 |
| software architecture: layered, microservices, MVC, client-server | groups, `kind`, `cylinder`, `cloud` | §5.3 |
| sequence diagram (lifelines, actors, activations, sync/async/return, create/destroy, alt/opt/loop) | `sequence` block, or Mermaid `sequenceDiagram` | §5.4 |
| UML: use case, activity, component, class, sequence, state, deployment, package, object | shapes + arrowheads + cards; Mermaid class/state | §5.5 |
| mind map: spider, tree, multi-flow, bubble | `radial` / `tree` / layered | §5.6 |
| Gantt chart, roadmap, dependencies FS/SS/FF/SF, milestones | `timeline` block, or Mermaid `gantt` | §5.7 |
| SWOT (with next steps) | `table` block | §5.8 |
| Lean Canvas, Business Model Canvas | `table` with `span`/`rowspan` and cell `sections` | §5.9 |
| competitor analysis: profile, matrix, radar, Porter's five forces, PESTLE, ERRC | `profile`, `quadrant`, `radar`, `table`, radial | §5.10 |
| user personas: starter, interview-based, statistical | `profile` block | §5.11 |
| user journey map | `journey` block | §5.11 |
| wireframe: low/mid/high fidelity, website, app, screen flow | `wireframe` blocks + edges from widgets | §5.12 |
| visual brainstorming: freewriting, brainwriting 6-3-5, mind map, reverse, SCAMPER, rolestorming, six thinking hats, starbursting, affinity | stickies, groups, grid, radial, tables | §5.13 |
| presentation, slides | groups with `slide: true` in a grid | §5.14 |
| game design: brainstorm, lo-fi prototype, mechanics, level map, HUD/menus, dialogue tree, story map, schedule, inspiration board | flows, `sketch`, `wireframe` (`device: "game"`), `tree`, `image`, `timeline` | §5.15 |
| job interviews: system design task, UX whiteboard challenge, interviewer notes, hiring process, candidate prep | frames, architecture, notes, lanes | §5.16 |
| education: explaining a concept, lecture slides, assignments | any of the above in frames/slides | §5.17 |
| a legend for colours or shapes | `legend` block | §4.9 |
| a picture (screenshot, photo, reference) | `image` block | §4.11 |
| an icon, an illustration, a map, anything none of the above draws | `sketch` block (shapes and pen strokes in your own coordinates) | §4.6 |
| headings, captions, paragraphs | `text` nodes with `size` | §2.1 |

## 2. Graph ops

Ids match `[A-Za-z0-9][A-Za-z0-9_.:>-]*` (ASCII). Re-sending an op with an
existing id UPDATES it; `null` clears an optional field. A batch is all or
nothing: an op that cannot be drawn is refused with its number and the reason,
and nothing changes.

### 2.1 node

```json
{ "op": "node", "id": "api", "label": "API", "kind": "service", "group": "cp" }
```

| field | values |
| --- | --- |
| `label` | text; `\n` for a line break (required for a new node) |
| `shape` | see the table below; default `rect` |
| `kind` | picks colour and shape when you name neither: `service` `api` (blue) · `ui` `client` (violet) · `user` `actor` (violet ellipse) · `store` `db` `file` (yellow) · `queue` `topic` (orange) · `job` `worker` `process` (green) · `external` (gray) · `decision` (pink diamond) · `config` (teal) |
| `color` | `blue` `green` `red` `yellow` `orange` `violet` `pink` `teal` `gray` `black`, or `#rrggbb` |
| `size` | `s` `m` (default) `l` `xl` — the label's font size; `l`/`xl` text nodes are titles |
| `fields` | turns a `rect` node into a **card**: the label is the title, then sections under rules. A list of lines is one section; a list of lists is several: `[["+id: UUID"], ["+login()"]]` |
| `link` | a URL (or any reference) the node opens: a study, a document, another plan |
| `group` | the group (or frame, or lane) it belongs to |
| `width`, `height` | fix the size (rarely needed; e.g. a 36x36 start dot) |

Shapes:

| `shape` | is | used for |
| --- | --- | --- |
| `rect` | rounded box | a step, a service, a class card |
| `ellipse`, `circle` | oval, circle | a use case, a DFD process (Yourdon), a start/end dot |
| `diamond` | diamond | a decision |
| `pill` | stadium | flowchart start / end (terminator) |
| `parallelogram` | slanted box | input / output |
| `document` | box with a wavy bottom | a document, a report |
| `cylinder` | database | a database, a store |
| `datastore` | box open on the right with an id column | a DFD data store (Gane-Sarson) |
| `hexagon` | hexagon | preparation; a centre idea |
| `actor` | stick figure, name under it | a UML actor, a user |
| `bar` | thick bar across the flow | UML fork / join |
| `box3d` | 3-D box | a UML deployment node, a server |
| `folder` | box with a tab | a UML package |
| `component` | box with the UML component icon | a UML component |
| `cloud` | cloud | the internet, a cloud provider, a CDN |
| `sticky` | sticky note that takes part in layout | brainstorming, retros |
| `text` | no border | headings, captions, paragraphs |

### 2.2 edge

```json
{ "op": "edge", "from": "api", "to": "db", "label": "SQL", "line": "dashed" }
```

| field | values |
| --- | --- |
| `from`, `to` | a node id, a **block** id (a screen, a table), or a **widget** on a screen as `<screen>.<widget id>` |
| `label` | what flows |
| `line` | `solid`, `dashed` (asynchronous, optional, return, «include»), `dotted` |
| `head` | the arrowhead at `to`; default `arrow` |
| `tail` | the arrowhead at `from`; default `none` |
| `color` | as for nodes |
| `id` | needed only for a second edge between the same pair (default `from->to`) |

Arrowheads: `none` `arrow` `bar` `circle` `circle_outline` `triangle`
`triangle_outline` `diamond` `diamond_outline` `cardinality_one`
`cardinality_many` `cardinality_one_or_many` `cardinality_exactly_one`
`cardinality_zero_or_one` `cardinality_zero_or_many`.

- plain line (mind map, org chart, actor to use case): `"head": "none"`
- both directions: `"tail": "arrow"`
- UML inheritance / realisation: `"head": "triangle_outline"` (realisation also `"line": "dashed"`)
- UML composition / aggregation: `"tail": "diamond"` / `"diamond_outline"` on the whole's side
- dependency, «include», «extend»: `"line": "dashed"`
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
| `frame` | `true` draws an Excalidraw **frame** (named, clips and moves its contents): a section of a board, a screen region |
| `slide` | `true` makes it a frame at least 960x540 (16:9): a presentation slide |
| `layout` | how THIS group arranges its members (§3) |
| `columns` | for `layout: "grid"`, members per row |

Frames do not nest inside frames, and a wireframe (itself a frame) cannot go in one.

### 2.4 note

```json
{ "op": "note", "on": "queue", "text": "survives a daemon crash", "color": "yellow" }
```

A sticky note beside its target (a node, edge, group or block) with a dashed
link, never on top of anything; without `on` it goes to a column on the right.
`link` works as on a node. Notes say what boxes cannot: a decision and why, an
invariant, a risk, an open question, interview feedback on a candidate's
drawing. Colours: `yellow` `blue` `green` `pink` `orange` `violet` `gray`.

### 2.5 remove, clear, layout, meta

- `{ "op": "remove", "id": "x" }` — a node or block takes its edges with it; a group's members move to its parent.
- `{ "op": "clear" }` — removes everything YOU drew; never what the owner drew.
- `{ "op": "layout", "direction": "DOWN", "algorithm": "tree", "columns": 3, "keepPinned": true }` — re-lays out everything now; every field optional.
- `{ "op": "meta", "theme": "sketch", "direction": "RIGHT", "layout": "grid", "columns": 3 }` — sets the defaults without laying out now.

`theme`: `clean` (Nunito / Pretendard, straight lines) or `sketch` (hand-drawn
lines, Excalifont / Gaegu: brainstorms, lo-fi wireframes, game sketches).
`direction`: `RIGHT` `DOWN` `LEFT` `UP`.

## 3. Layout

You never give coordinates for graph things; the canvas places them. Each
container (the whole drawing, or a group) arranges its own members:

| `layout` | arranges | good for |
| --- | --- | --- |
| `layered` (default) | in ranks along `direction`, edges routed around boxes | flows, architecture, UML, ER, states, DFDs, multi-flow maps |
| `tree` | a hierarchy, parent above children | org charts, tree maps, decision and dialogue trees, sitemaps |
| `radial` | the first root in the middle, branches around it, straight lines | spider mind maps, starbursting, SCAMPER, Porter's five forces |
| `grid` | rows and columns in the order you made them (`columns` per row) | boards, card walls, personas, slide decks, blocks side by side |
| `lanes` | the group's child groups are lanes (bands); steps are ranked along the lanes and stay in their own lane | swimlane flowcharts, activity diagrams with partitions, hiring and handover processes |

A group with no `layout` follows its parent, except that a group inside a grid
whose members are joined by an edge is laid out `layered` (a diagram on a
slide stays a diagram). An edge between things laid out by different
containers, an edge between lanes and an edge from a widget is drawn as an
elbow arrow the editor routes.

Once the owner has moved something by hand, new things are placed around it
and nothing they placed moves until you send `{"op":"layout"}` (or
`{"op":"layout","keepPinned":true}`).

## 4. Blocks

A block is one figure described as data. The canvas draws it as one unit; the
layout places it like a node; edges and notes may attach to it. To change a
block, **resend the whole op with the same id** (describe prints each block's
current op). Every block takes an optional `group`.

### 4.1 table

```json
{ "op": "table", "id": "cmp", "title": "기능 비교",
  "columns": ["", "우리", "A사"], "rowHeaders": true,
  "rows": [["가격", "₩9,000", "₩20,000"], ["실시간 협업", "✓", "—"]] }
```

- `columns`: the header row (optional). `rowHeaders: true` makes each row's first cell a header.
- `rows`: lists of cells. A cell is text, or `{ "title", "text", "items": [...], "sections": [{ "title", "items" | "text" }], "color", "span", "rowspan", "align" }` — `title` in the cell's colour, `items` as bullets, `sections` as titled parts inside the cell, `span`/`rowspan` like HTML.
- `color`: the header colour (default blue). `maxColumnWidth` (default 280) — longer text wraps.

### 4.2 quadrant

```json
{ "op": "quadrant", "id": "prio", "title": "우선순위",
  "x": ["노력 적음", "노력 많음"], "y": ["영향 작음", "영향 큼"],
  "quadrants": ["계획", "바로 하기", "버리기", "나중에"],
  "items": [{ "label": "검색 개편", "x": 0.3, "y": 0.8, "color": "violet" }] }
```

`x`/`y` are `[low, high]` axis labels; `quadrants` follow Mermaid's numbering
(1 top-right, 2 top-left, 3 bottom-left, 4 bottom-right); each item's `x`, `y`
is between 0 and 1.

### 4.3 sequence

```json
{ "op": "sequence", "id": "checkout", "title": "결제", "autonumber": true,
  "participants": [{ "id": "u", "label": "고객", "kind": "actor" }, "cart", "pay", "order"],
  "items": [
    { "from": "u", "to": "cart", "label": "결제하기", "activate": true },
    { "from": "cart", "to": "order", "label": "new", "create": true },
    { "from": "cart", "to": "pay", "label": "승인 요청", "activate": true },
    { "from": "pay", "to": "cart", "label": "결과 이벤트", "kind": "async" },
    { "fragment": "alt", "label": "승인", "items": [
        { "from": "pay", "to": "cart", "label": "승인됨", "kind": "reply", "deactivate": true } ],
      "else": [{ "label": "거절", "items": [
        { "from": "pay", "to": "cart", "label": "거절", "kind": "reply", "deactivate": true } ] }] },
    { "from": "cart", "to": "cart", "label": "재고 차감" },
    { "from": "cart", "to": "order", "label": "정리", "destroy": true },
    { "from": "cart", "to": "u", "label": "완료 화면", "kind": "reply", "deactivate": true },
    { "note": "모든 구간 TLS", "over": ["u", "cart"] }
  ] }
```

- participants: an id, or `{ id, label, kind, color }`; `kind: "actor"` draws a stick figure.
- a message: `{ from, to, label, kind, activate, deactivate, create, destroy, line, head }`
  - `kind`: `sync` (default, filled head: the caller waits), `async` (open head: it does not wait), `reply` (dashed, open head);
  - `activate: true` opens an activation bar on `to`; `deactivate: true` closes the sender's bar (the reply that ends the call);
  - `create: true` draws `to`'s box where the message reaches it; `destroy: true` ends `to`'s lifeline with an X;
  - `from == to` is a self message.
- `{ activate: id }` / `{ deactivate: id }` alone open or close a bar where you are.
- a note: `{ note, over: id | [id, id], color }`.
- a fragment: `{ fragment: alt | opt | loop | par | critical | break | rect, label, items, else: [{ label, items }] }` — the label is the [condition]; nesting allowed.

### 4.4 timeline (Gantt, roadmap)

```json
{ "op": "timeline", "id": "q4", "title": "4분기 계획", "today": "2026-10-21", "todayLabel": "오늘", "weekends": true,
  "tasks": [
    { "id": "design", "label": "화면 설계", "section": "설계", "start": "2026-10-01", "days": 10, "status": "done", "owner": "지은" },
    { "id": "api", "label": "API", "section": "개발", "after": "design", "days": 14, "progress": 0.4, "owner": "민수" },
    { "id": "art", "label": "아트", "section": "개발", "start": "2026-10-05", "days": 12, "depends": [{ "on": "design", "type": "SS" }] },
    { "id": "qa", "label": "QA", "section": "출시", "start": "2026-11-01", "end": "2026-11-07", "status": "pending", "depends": [{ "on": "api", "type": "FF" }] },
    { "label": "출시", "section": "출시", "start": "2026-11-20", "milestone": true, "depends": ["qa"] }
  ] }
```

- `start`: a date `YYYY-MM-DD` (or a plain number for abstract steps such as sprints, with `stepLabel: "S"`); `after`: an earlier task's `id` (starts when it ends; drawn as a finish-to-start arrow).
- length: `end` (the last day, included) or `days`; `milestone: true` is a diamond.
- `depends`: ids or `{ on, type }` with `type` `FS` (finish-to-start, default), `SS`, `FF`, `SF`; drawn as arrows between the bars.
- `status`: `done` (green), `active`, `pending` (grey), `delayed` (red), `blocked` (orange); `progress` (0–1); `owner` is written after the bar; `section` groups rows under a band; `color` overrides.
- `unit`: `day` `week` `month` `quarter` (chosen from the span when absent); `today` draws a red line; `weekends: true` shades Saturdays and Sundays.

### 4.5 wireframe

```json
{ "op": "wireframe", "id": "login", "label": "로그인", "device": "mobile", "fidelity": "mid",
  "items": [
    { "type": "header", "label": "Cerebrate", "items": ["도움말"] },
    { "type": "heading", "level": 1, "label": "다시 오신 걸 환영해요" },
    { "type": "input", "label": "이메일", "text": "you@example.com" },
    { "type": "checkbox", "label": "로그인 유지", "checked": true },
    { "type": "row", "items": [{ "type": "button", "id": "submit", "label": "로그인" }, { "type": "button", "label": "가입", "primary": false }] },
    { "type": "tabbar", "items": ["홈", "검색", "나"] }
  ] }
```

A screen drawn as a named frame. `device`: `mobile` (375 wide, default),
`tablet` (768), `desktop` (1440), `browser` (1440 with a window bar), `game`
(1280x720 landscape). `fidelity`: `low` (greyscale, body copy as grey lines,
hand-drawn lines — for exploring), `mid` (default: greyscale, real copy, a blue
primary), `high` (real copy in the brand `color`, filled header and hero — for
reviews and handoff). Widgets stack top to bottom; `row` puts its `items` side
by side, `grid` wraps them in `columns`.

| type | fields |
| --- | --- |
| `header` | app bar: `label` (title), `items` (menu words on the right) |
| `nav` | website top bar: `label` (logo text), `items` (menu), `text` (call-to-action button) |
| `hero` | website banner: `label` (headline), `text`, `items` (up to two buttons), `image` (caption of the picture beside it) |
| `section` | a band across the page: `label` (section title), `items` (widgets), `fill: false` for no tint |
| `footer` | `items`: columns of links, the first entry of each is its heading; `label` (copyright line) |
| `heading` | `label`, `level` 1 (XL) · 2 (L) · 3 (M) |
| `title`, `text`, `link` | `label` or `text`; low fidelity draws `text` as grey lines unless `real: true` |
| `button` | `label`, `primary: false` for an outlined one, `full: false` for one only as wide as its label |
| `input`, `textarea`, `search`, `select` | `label` (above), `text` (placeholder) |
| `checkbox`, `radio`, `toggle` | `label`, `checked` |
| `image` | `label` (caption), `height`: `s` `m` `l` |
| `card` | `label` (title), `text`, `image` (a picture placeholder on top) |
| `list` | `items` (rows with a chevron) |
| `tabs`, `chips` | `items` (the first is selected) |
| `tabbar` | `items` — pinned to the bottom of the screen |
| `table` | `items`: rows of cells, the first row is the header |
| `avatar`, `icon`, `badge` | `label`; `icon` takes a `symbol` |
| `progress` | `label`, `value` (0–1), `color` — also a game's HP/MP bar |
| `slots` | game inventory or skill bar: `items` (what is in each slot), `count`, `columns` |
| `minimap` | a game's minimap, `label` |
| `divider`, `spacer` | `spacer` takes `height`: `s` `m` `l` |
| `row`, `grid` | `items`: widgets; `grid` takes `columns` |

Any widget may carry an `id`; an edge then starts or ends at it as
`<screen>.<id>`: `{"op":"edge","from":"login.submit","to":"home","label":"로그인 성공"}`.
Screens joined that way are laid out along the flow.

### 4.6 sketch (free drawing)

When nothing above fits, draw in the block's own coordinates (any origin; the
block starts at the drawing's top-left corner and is placed by the layout).

```json
{ "op": "sketch", "id": "server", "label": "서버 한 대",
  "elements": [
    { "type": "rect", "x": 0, "y": 0, "w": 120, "h": 160, "color": "gray", "fill": true, "rounded": true },
    { "type": "line", "points": [[10, 40], [110, 40]] },
    { "type": "ellipse", "x": 92, "y": 18, "w": 10, "h": 10, "color": "green", "fill": "green" },
    { "type": "polygon", "points": [[140, 20], [180, 0], [220, 20], [200, 60], [160, 60]], "color": "teal", "fill": true },
    { "type": "freedraw", "points": [[140, 90], [160, 110], [150, 130], [175, 150]], "color": "blue", "width": 3 },
    { "type": "arrow", "points": [[130, 80], [200, 80], [200, 20]], "line": "dashed" },
    { "type": "text", "x": 160, "y": 170, "text": "heartbeat", "size": "s", "align": "center" }
  ] }
```

| type | fields |
| --- | --- |
| `rect`, `ellipse`, `diamond` | `x`, `y`, `w`, `h`; `text` (a centred label), `fill` (`true` = the colour's tint, a colour name, or `"none"`), `fillStyle` (`solid` `hachure` `cross-hatch`), `rounded` |
| `polygon` | `points` (a closed outline), `fill` |
| `line`, `arrow` | `points` (two or more `[x, y]`), `head`, `tail` |
| `freedraw` | `points`: a pen stroke through them (hand-drawn paths, rivers, scribbles) |
| `text` | `x`, `y`, `text`, `align` (`left` from x, `center` around x, `right` up to x) |
| all | `color`, `line` (`solid` `dashed` `dotted`), `width` (stroke 1–8), `size` (`s` `m` `l` `xl` or a number), `opacity` (0–100) |

### 4.7 profile (persona, competitor profile, candidate)

```json
{ "op": "profile", "id": "jieun", "name": "김지은", "subtitle": "PM · 32세 · 서울", "color": "violet",
  "quote": "어디까지 됐는지 한눈에 보고 싶어요",
  "tags": ["문제 해결형", "도구를 많이 씀"],
  "sections": [
    { "title": "목표", "items": ["주간 보고 10분 안에"] },
    { "title": "불편", "items": ["채널마다 흩어진 맥락"] },
    { "title": "우리 팀이 할 일", "items": ["한 화면 대시보드"] }
  ],
  "scales": [{ "label": "기술 친숙도", "low": "낮음", "high": "높음", "value": 0.7 }],
  "share": 0.42, "shareLabel": "전체 사용자의 42%" }
```

`avatar` replaces the initials; `columns` (1–3) lays the sections side by side;
`size` `s` `m` `l`. `tags` carry psychographics, `scales` traits between two
poles, `share` a statistical persona's part of the user base.

### 4.8 radar (spider chart)

```json
{ "op": "radar", "id": "features", "title": "기능 비교 (1–5)", "max": 5,
  "axes": ["가격", "연동", "사용성", "지원", "확장성"],
  "series": [{ "label": "우리", "values": [4, 5, 4, 3, 4], "color": "violet" },
             { "label": "A사", "values": [2, 4, 5, 4, 3], "color": "red" }] }
```

3–12 axes; each series has one value per axis between 0 and `max`; a legend is
drawn under the chart. Keep it to the main rivals.

### 4.9 legend

```json
{ "op": "legend", "id": "key", "title": "범례",
  "items": [{ "label": "완료", "color": "green" }, { "label": "지연", "color": "red" },
            { "label": "비동기", "shape": "dashed" }, { "label": "아이디어", "shape": "sticky" }] }
```

`shape`: `rect` (default), `ellipse`, `line`, `dashed`, `arrow`, `sticky`.

### 4.10 journey (user journey map)

```json
{ "op": "journey", "id": "checkout", "title": "온라인 결제 여정", "persona": "김지은", "color": "blue",
  "stages": ["상품 탐색", "장바구니", "결제 정보", "결제 완료"],
  "rows": [
    { "label": "행동", "cells": ["검색, 필터", "수량 변경", "주소·카드 입력", "영수증 확인"] },
    { "label": "불편", "cells": ["", "배송비가 늦게 보임", "주소 자동완성 없음", ""] },
    { "label": "기회", "cells": ["", "배송비 먼저 표시", "주소 검색", "재구매 버튼"] }
  ],
  "emotions": [1, 0, -2, 2], "emotionLabel": "감정" }
```

`emotions`: one score per stage from -2 to 2, drawn as a curve with faces.

### 4.11 image

```json
{ "op": "image", "id": "ref1", "src": "screens/home.png", "label": "현재 홈 화면", "width": 320 }
```

`src` is a png, jpg, webp, gif or svg file path (the command reads it; at most
650 KB) or a data URL. `width` sets the drawn width; the height follows the
picture. Resend with the same id and no `src` to change the caption or width.

## 5. Recipes

Each recipe is a starting point; adapt the words. Long batches go in a file
(`--ops-file`). Excalidraw's own advice is folded in: keep diagrams simple,
consistent symbols and colours, label edges, one idea per box.

### 5.1 Flowcharts — process, swimlane, data, decision

Standard symbols: `pill` start/end, `rect` step, `diamond` (`kind: "decision"`)
yes/no question, `parallelogram` input/output, `document`, `cylinder` database,
`hexagon` preparation, `circle` connector. Label every branch.

```json
[{"op":"meta","direction":"DOWN"},
 {"op":"node","id":"start","label":"주문 시작","shape":"pill","color":"green"},
 {"op":"node","id":"in","label":"주소 입력","shape":"parallelogram","color":"blue"},
 {"op":"node","id":"stock","label":"재고 있음?","kind":"decision"},
 {"op":"node","id":"db","label":"orders DB","shape":"cylinder","color":"yellow"},
 {"op":"node","id":"slip","label":"송장 출력","shape":"document","color":"violet"},
 {"op":"node","id":"wait","label":"입고 대기","shape":"circle","color":"gray"},
 {"op":"node","id":"end","label":"끝","shape":"pill","color":"red"},
 {"op":"edge","from":"start","to":"in"},{"op":"edge","from":"in","to":"stock"},
 {"op":"edge","from":"stock","to":"db","label":"예"},{"op":"edge","from":"stock","to":"wait","label":"아니오"},
 {"op":"edge","from":"db","to":"slip"},{"op":"edge","from":"slip","to":"end"}]
```

A **swimlane** flowchart puts each step in the lane of who does it:

```json
[{"op":"group","id":"proc","label":"환불 처리","layout":"lanes"},
 {"op":"group","id":"cust","label":"고객","parent":"proc","color":"violet"},
 {"op":"group","id":"cs","label":"CS팀","parent":"proc","color":"blue"},
 {"op":"group","id":"fin","label":"재무팀","parent":"proc","color":"green"},
 {"op":"node","id":"ask","label":"환불 요청","group":"cust","shape":"pill"},
 {"op":"node","id":"check","label":"주문 확인","group":"cs"},
 {"op":"node","id":"ok","label":"환불 가능?","group":"cs","kind":"decision"},
 {"op":"node","id":"pay","label":"환불 지급","group":"fin"},
 {"op":"node","id":"done","label":"완료 안내","group":"cs","shape":"pill"},
 {"op":"edge","from":"ask","to":"check"},{"op":"edge","from":"check","to":"ok"},
 {"op":"edge","from":"ok","to":"pay","label":"예"},{"op":"edge","from":"pay","to":"done"}]
```

`direction: "DOWN"` turns the lanes into columns. A **data flowchart** is a DFD
(§5.2); a **decision flowchart** is diamonds and labelled yes/no branches ending
in outcomes (`layout: "tree"` reads well for troubleshooting).

### 5.2 Data flow diagrams — logical and physical

Gane-Sarson notation: processes are numbered rounded `rect`s (`"1.0\n주문 접수"`),
data stores `datastore` (`"D1 주문"`), external entities `kind: "external"`.
Yourdon/Coad: processes are `circle`s, stores two lines (`datastore` is the
closest), externals rectangles. Every process and store has an input and an
output; data passes a process before entering or leaving a store; every edge
names the data. A **logical** DFD names business steps; a **physical** DFD
names the systems (`"API 서버"`, `"PostgreSQL"`, `kind` and `cylinder`).

```json
[{"op":"node","id":"cust","label":"고객","kind":"external"},
 {"op":"node","id":"p1","label":"1.0\n주문 접수","color":"blue"},
 {"op":"node","id":"d1","label":"D1 주문","shape":"datastore","color":"yellow"},
 {"op":"node","id":"p2","label":"2.0\n결제 처리","color":"blue"},
 {"op":"node","id":"bank","label":"결제사","kind":"external"},
 {"op":"edge","from":"cust","to":"p1","label":"주문 정보"},{"op":"edge","from":"p1","to":"d1","label":"주문 기록"},
 {"op":"edge","from":"d1","to":"p2","label":"결제할 주문"},{"op":"edge","from":"p2","to":"bank","label":"결제 요청"},
 {"op":"edge","from":"p2","to":"cust","label":"영수증"}]
```

### 5.3 Software architecture — layered, microservices, MVC, client-server

**Layered**: one group per layer stacked in a single column.

```json
[{"op":"meta","layout":"grid","columns":1},
 {"op":"group","id":"pres","label":"Presentation","layout":"grid","columns":3,"color":"violet"},
 {"op":"group","id":"biz","label":"Business","layout":"grid","columns":3,"color":"blue"},
 {"op":"group","id":"data","label":"Data","layout":"grid","columns":3,"color":"yellow"},
 {"op":"node","id":"web","label":"Web UI","group":"pres"},{"op":"node","id":"app","label":"Mobile","group":"pres"},
 {"op":"node","id":"orders","label":"주문 규칙","group":"biz"},{"op":"node","id":"billing","label":"청구","group":"biz"},
 {"op":"node","id":"pg","label":"PostgreSQL","shape":"cylinder","group":"data","color":"yellow"}]
```

**Microservices**: a gateway, one `kind: "service"` per service each with its
own `cylinder` store, a `kind: "topic"` bus with dashed asynchronous edges.
**MVC**: three nodes `Model` (`kind: "store"`), `View` (`kind: "ui"`),
`Controller` (`kind: "service"`) with labelled edges (user input, update,
notify, render). **Client-server**: `client` nodes (`kind: "client"`), a
`cloud` for the network, `box3d` servers, a `cylinder`. Label edges with the
protocol (`HTTPS`, `gRPC`, `SQL`); link nodes to their docs with `link`.

### 5.4 Sequence diagrams

The `sequence` block (§4.3), or Mermaid `sequenceDiagram` with `activate`,
`+`/`-`, `create participant`, `destroy`, `-)` for async. Excalidraw's advice:
a synchronous call already implies a return, so add replies only when the
detail matters; use alt/opt/loop for conditions; one use case per diagram.

### 5.5 UML diagrams

**Use case**: `actor` nodes outside a system-boundary group of `ellipse` use
cases; actor–use case edges with `head: "none"`; «include» / «extend» dashed.

```json
[{"op":"node","id":"dev","label":"개발자","shape":"actor","color":"violet"},
 {"op":"group","id":"sys","label":"CI/CD 플랫폼"},
 {"op":"node","id":"push","label":"코드 푸시","shape":"ellipse","group":"sys"},
 {"op":"node","id":"test","label":"테스트 실행","shape":"ellipse","group":"sys"},
 {"op":"edge","from":"dev","to":"push","head":"none"},
 {"op":"edge","from":"push","to":"test","label":"«include»","line":"dashed"}]
```

**Activity**: a start dot (`circle`, `"●"`, `size: "s"`, `width`/`height` 36),
actions as `rect`s, `diamond` decisions, `bar` fork and join for parallel work,
an end `circle` (`"◉"`); partitions are `lanes` (§5.1).

```json
[{"op":"node","id":"s","label":"●","shape":"circle","color":"black","size":"s","width":36,"height":36},
 {"op":"node","id":"build","label":"빌드"},
 {"op":"node","id":"fork","label":"fork","shape":"bar","color":"black"},
 {"op":"node","id":"unit","label":"단위 테스트"},{"op":"node","id":"integ","label":"통합 테스트"},
 {"op":"node","id":"join","label":"join","shape":"bar","color":"black"},
 {"op":"node","id":"e","label":"◉","shape":"circle","color":"black","size":"s","width":36,"height":36},
 {"op":"edge","from":"s","to":"build"},{"op":"edge","from":"build","to":"fork"},
 {"op":"edge","from":"fork","to":"unit"},{"op":"edge","from":"fork","to":"integ"},
 {"op":"edge","from":"unit","to":"join"},{"op":"edge","from":"integ","to":"join"},{"op":"edge","from":"join","to":"e"}]
```

**Component**: `component` nodes, dependencies dashed with `head: "arrow"`.
**Deployment**: `box3d` nodes (servers, devices) holding `component`s or
artifacts (put them in a group named for the node), `«deploy»` dashed edges.
**Package**: `folder` nodes with dashed dependency edges. **Class**: cards
(attributes, then methods) — §5.5.1. **Sequence**: §4.3. **State**: §5.5.2.
**Object**: cards titled `name : Class` with attribute values. **Communication**:
a graph whose edge labels are numbered messages (`1: login()`). Timing and
composite structure diagrams: a `sketch` block.

#### 5.5.1 Class diagram

```json
[{"op":"node","id":"animal","label":"«abstract»\nAnimal","color":"blue","fields":[["+name: String"],["+eat(food) void"]]},
 {"op":"node","id":"dog","label":"Dog","color":"blue","fields":[[],["+bark() void"]]},
 {"op":"node","id":"leg","label":"Leg","color":"blue"},
 {"op":"edge","from":"dog","to":"animal","head":"triangle_outline"},
 {"op":"edge","from":"dog","to":"leg","tail":"diamond","head":"none","label":"4"},
 {"op":"layout","direction":"UP"}]
```

ER diagrams are the same with `color: "yellow"`, one section of `column: type
PK/FK`, and crow's-foot heads; Mermaid `erDiagram` writes it for you.

#### 5.5.2 State machine

States are rounded rects; start and end small `circle`s; transitions labelled
with the event; a composite state is a group; a choice is a `diamond`. Mermaid
`stateDiagram-v2` produces exactly this (a game's states, a build pipeline
`Queued → Running → Passed → Deploying → Deployed` with `Failed`, `Cancelled`).

### 5.6 Mind maps — spider, tree, multi-flow, bubble

**Spider map**: `layout: "radial"`, the central idea `ellipse` `size: "l"`, one
colour per first-level branch inherited by its children, `head: "none"`.

```json
[{"op":"meta","layout":"radial"},
 {"op":"node","id":"root","label":"출시 준비","shape":"ellipse","size":"l","color":"violet"},
 {"op":"node","id":"mkt","label":"마케팅","color":"blue"},{"op":"edge","from":"root","to":"mkt","head":"none","color":"blue"},
 {"op":"node","id":"mkt1","label":"블로그 글","size":"s","color":"blue"},{"op":"edge","from":"mkt","to":"mkt1","head":"none","color":"blue"},
 {"op":"node","id":"dev","label":"개발","color":"green"},{"op":"edge","from":"root","to":"dev","head":"none","color":"green"}]
```

**Tree map**: `layout: "tree"`, `direction: "DOWN"` (a course outline, a
project plan). **Multi-flow map**: causes → the event → effects, layered
`RIGHT`, the event in the middle, a `legend` for the colours:

```json
[{"op":"node","id":"c1","label":"이미지 용량 큼","color":"orange"},
 {"op":"node","id":"c2","label":"캐시 없음","color":"orange"},
 {"op":"node","id":"ev","label":"사이트가 느려짐","shape":"ellipse","color":"red","size":"l"},
 {"op":"node","id":"e1","label":"이탈률 증가","color":"violet"},
 {"op":"edge","from":"c1","to":"ev"},{"op":"edge","from":"c2","to":"ev"},{"op":"edge","from":"ev","to":"e1"},
 {"op":"legend","id":"key","items":[{"label":"원인","color":"orange"},{"label":"사건","color":"red","shape":"ellipse"},{"label":"결과","color":"violet"}]}]
```

**Bubble map**: radial with `circle` nodes. Keep branches to short phrases; link a
node to a detailed plan with `link`; a nested map is another plan or a group.

### 5.7 Gantt charts and roadmaps

The `timeline` block (§4.4): sections per team or phase, `after`/`depends` for
FS/SS/FF/SF dependencies, `milestone` for launches, `status` colours (green
done, grey pending, red delayed), `owner` per bar, `today`, `weekends`. A
roadmap is `unit: "quarter"` with long bars. Keep it to the critical tasks;
add notes for context.

### 5.8 SWOT

```json
[{"op":"table","id":"swot","title":"SWOT — 예산 앱","rows":[
   [{"title":"Strengths 강점","items":["코딩·디자인 역량","창업자가 직접 겪은 문제"],"color":"green"},
    {"title":"Weaknesses 약점","items":["세법 전문성 부족","작은 SNS 팔로잉"],"color":"orange"}],
   [{"title":"Opportunities 기회","items":["자동 세금 추정","뉴스레터 제휴"],"color":"blue"},
    {"title":"Threats 위협","items":["비슷한 앱이 많음"],"color":"red"}]]},
 {"op":"table","id":"next","title":"Next steps","columns":["항목","할 일","담당"],"rows":[
   ["W: 세법 전문성","세무사 자문 계약","지은"],["T: 경쟁 앱","차별 기능 3개 정의","민수"]]},
 {"op":"note","on":"swot","text":"항목은 중요도 순서","color":"blue"}]
```

Be specific, order points by priority, colour-code by topic when several teams
contribute, back claims with `link`s, and match each point with a follow-up in
the Next steps table.

### 5.9 Lean Canvas and Business Model Canvas

A 10-column table: five cells of `span: 2` in the top two rows, with Problem,
Unique Value Proposition and Customer Segments `rowspan: 2`; the bottom row is
Cost Structure and Revenue Streams, `span: 5` each. Problem holds an "Existing
alternatives" section and Customer Segments an "Early adopters" section.

```json
{"op":"table","id":"lean","title":"Lean Canvas","maxColumnWidth":130,"rows":[
  [{"title":"Problem","items":["…"],"sections":[{"title":"Existing alternatives","items":["…"]}],"span":2,"rowspan":2},
   {"title":"Solution","items":["…"],"span":2},
   {"title":"Unique Value Proposition","text":"…","span":2,"rowspan":2,"color":"violet"},
   {"title":"Unfair Advantage","text":"…","span":2},
   {"title":"Customer Segments","items":["…"],"sections":[{"title":"Early adopters","items":["…"]}],"span":2,"rowspan":2}],
  [{"title":"Key Metrics","items":["…"],"span":2},{"title":"Channels","items":["…"],"span":2}],
  [{"title":"Cost Structure","items":["…"],"span":5},{"title":"Revenue Streams","items":["…"],"span":5}]]}
```

The **Business Model Canvas** has nine blocks in the same 10-column grid: Key
Partners (`span: 2, rowspan: 2`), Key Activities and Key Resources stacked
(`span: 2` each), Value Propositions (`span: 2, rowspan: 2`), Customer
Relationships and Channels stacked (`span: 2`), Customer Segments (`span: 2,
rowspan: 2`); bottom row Cost Structure and Revenue Streams (`span: 5`). Keep
cells to keywords; link evidence; refer to the personas of each segment.

### 5.10 Competitor analysis

Use several frameworks together:

- **Competitor profile**: one `profile` per main rival (two to four): pricing, features, target users, strengths, weaknesses.
- **Competitive matrix**: a `quadrant` on two factors buyers care about, quadrants named (`"leaders"`, `"challengers"` …), us in a distinct colour.
- **Radar chart**: a `radar` on 4–8 factors rated 1–5.
- **Porter's five forces**: radial, rivalry in the centre, four forces around with two-way edges, each labelled with its pressure:

```json
[{"op":"meta","layout":"radial"},
 {"op":"node","id":"rivalry","label":"경쟁 강도\n높음","shape":"circle","color":"red","size":"l"},
 {"op":"node","id":"new","label":"신규 진입자\n중간","color":"orange"},
 {"op":"node","id":"sub","label":"대체재\n높음","color":"orange"},
 {"op":"node","id":"buyer","label":"구매자 교섭력\n낮음","color":"green"},
 {"op":"node","id":"supplier","label":"공급자 교섭력\n낮음","color":"green"},
 {"op":"edge","from":"rivalry","to":"new","tail":"arrow"},{"op":"edge","from":"rivalry","to":"sub","tail":"arrow"},
 {"op":"edge","from":"rivalry","to":"buyer","tail":"arrow"},{"op":"edge","from":"rivalry","to":"supplier","tail":"arrow"}]
```

- **PESTLE**: a 3x2 `table` of coloured cells (Political, Economic, Social, Technological, Legal, Environmental).
- **ERRC grid**: a 2x2 `table` (Eliminate red, Reduce orange, Raise blue, Create green) — the summary of the analysis.

Give each competitor one colour and keep it across every chart.

### 5.11 User personas and journey maps

Three approaches, the same `profile` block: **starter (proto) personas** from a
workshop — 3–6 profiles with hypotheses as tags; **interview-based** — quotes
and patterns from 5–30 interviews; **statistical** — add `share` for each
group's part of the user base. Use psychographics (`tags` such as
"money-saving business owner"), `scales` for traits, and an actionable section
("우리 팀이 할 일"). 3–7 personas; `layout: "grid"`.

```json
[{"op":"meta","layout":"grid","columns":2},
 {"op":"profile","id":"p1","name":"김지은","subtitle":"PM · 32세","color":"violet","quote":"어디까지 됐지?",
  "sections":[{"title":"목표","items":["진행을 한눈에"]},{"title":"우리 팀이 할 일","items":["대시보드 한 화면"]}],
  "scales":[{"label":"기술 친숙도","low":"낮음","high":"높음","value":0.7}],"share":0.42},
 {"op":"profile","id":"p2","name":"박민수","subtitle":"개발자 · 28세","color":"teal","quote":"그거 문서에 있어요",
  "sections":[{"title":"목표","items":["방해 없이 집중"]}],"share":0.31}]
```

A **journey map** is the `journey` block (§4.10): stages across, rows for
actions, thoughts, pain points and opportunities, the emotion curve under them.

### 5.12 Wireframes — fidelity, website, app, flows

- **Low fidelity** to explore: `fidelity: "low"`, the `sketch` theme, several alternative screens side by side.
- **Mid fidelity** for reviews: real copy, image placeholders.
- **High fidelity** for handoff and early usability tests: `fidelity: "high"`, `color` the brand colour, real copy everywhere.
- **Website**: `device: "browser"` or `"desktop"`; `nav` first, then `hero`, `section`s (a `grid` of `card`s for features), headings by level (XL H1, L H2), `footer`.
- **App**: `device: "mobile"`; `header`, content, `tabbar`. Draw the flow, not single screens: several screens, `id`s on the widgets that move the user, edges `<screen>.<widget>` → next screen labelled with the action, notes for the intended behaviour.

```json
[{"op":"wireframe","id":"signup","label":"가입","fidelity":"low","items":[
   {"type":"header","label":"가입"},{"type":"heading","level":1,"label":"계정 만들기"},
   {"type":"input","label":"이메일"},{"type":"button","id":"next","label":"다음"}]},
 {"op":"wireframe","id":"verify","label":"인증","fidelity":"low","items":[
   {"type":"header","label":"인증"},{"type":"input","label":"코드"},{"type":"button","id":"done","label":"확인"}]},
 {"op":"edge","from":"signup.next","to":"verify","label":"코드 발송"},
 {"op":"note","on":"verify","text":"코드 재발송은 60초 뒤에만"}]
```

```json
{"op":"wireframe","id":"landing","label":"랜딩","device":"browser","fidelity":"high","color":"violet","items":[
  {"type":"nav","label":"Cerebrate","items":["기능","가격"],"text":"무료로 시작"},
  {"type":"hero","label":"흩어진 일을 한곳에서","text":"작업과 기록을 하나로.","items":["시작하기","데모"],"image":"제품 화면"},
  {"type":"section","label":"주요 기능","items":[{"type":"grid","columns":3,"items":[
    {"type":"card","label":"작업 추적","text":"누가 무엇을"},{"type":"card","label":"지식 연결","text":"기록이 다시 쓰인다"},
    {"type":"card","label":"에이전트","text":"대신 그린다"}]}]},
  {"type":"footer","label":"© 2026","items":[["제품","기능","가격"],["회사","소개"]]}]}
```

### 5.13 Visual brainstorming techniques

- **Freewriting / freedrawing**: `sketch` theme, `sticky` nodes in a loose grid, `sketch` blocks with `freedraw` strokes.
- **Brainwriting 6-3-5**: a `table` with 6 rows (participants) and 3 columns (ideas), one round per table or per column set.
- **Mind mapping**: §5.6. **Flowcharts**: §5.1.
- **Reverse brainstorming**: a two-column `table` ("어떻게 하면 더 나빠질까?" | "뒤집으면"), or stickies of problems with edges to their reversed actions.
- **SCAMPER**: radial, the idea in the centre, seven branches Substitute, Combine, Adapt, Modify, Put to another use, Eliminate, Reverse — one colour each.
- **Rolestorming**: a `profile` per role or persona, each with its group of stickies.
- **Six thinking hats**: six groups in a 3-column grid — ⚪ facts (`gray`), 🔴 emotions (`red`), ⚫ risks (`black`), 🟡 benefits (`yellow`), 🟢 creativity (`green`), 🔵 process (`blue`) — stickies inside.
- **Starbursting**: radial, the idea in a `hexagon`, six branches Who / What / Where / When / Why / How, each with its questions.
- **Affinity diagram**: one group per theme, stickies inside, `layout: "grid"`; a final group "Easy wins".

```json
[{"op":"meta","layout":"grid","columns":3,"theme":"sketch"},
 {"op":"group","id":"facts","label":"⚪ 사실","layout":"grid","columns":1,"color":"gray"},
 {"op":"group","id":"feel","label":"🔴 감정","layout":"grid","columns":1,"color":"red"},
 {"op":"group","id":"risk","label":"⚫ 위험","layout":"grid","columns":1,"color":"black"},
 {"op":"group","id":"gain","label":"🟡 이점","layout":"grid","columns":1,"color":"yellow"},
 {"op":"group","id":"idea","label":"🟢 아이디어","layout":"grid","columns":1,"color":"green"},
 {"op":"group","id":"next","label":"🔵 진행","layout":"grid","columns":1,"color":"blue"},
 {"op":"node","id":"f1","label":"베타 사용자 40명","shape":"sticky","group":"facts","color":"gray"},
 {"op":"node","id":"r1","label":"출시 일정 촉박","shape":"sticky","group":"risk","color":"gray"},
 {"op":"node","id":"i1","label":"튜토리얼을 게임처럼","shape":"sticky","group":"idea","color":"green"}]
```

```json
[{"op":"meta","layout":"radial"},
 {"op":"node","id":"c","label":"새 알림 기능","shape":"hexagon","color":"violet","size":"l"},
 {"op":"node","id":"who","label":"누가 쓰나?","color":"blue"},{"op":"edge","from":"c","to":"who","head":"none"},
 {"op":"node","id":"what","label":"무슨 문제를?","color":"green"},{"op":"edge","from":"c","to":"what","head":"none"},
 {"op":"node","id":"where","label":"어디에 보이나?","color":"orange"},{"op":"edge","from":"c","to":"where","head":"none"},
 {"op":"node","id":"when","label":"언제 켜나?","color":"teal"},{"op":"edge","from":"c","to":"when","head":"none"},
 {"op":"node","id":"why","label":"왜 필요한가?","color":"pink"},{"op":"edge","from":"c","to":"why","head":"none"},
 {"op":"node","id":"how","label":"어떻게 잴까?","color":"red"},{"op":"edge","from":"c","to":"how","head":"none"}]
```

End a session by turning ideas into next steps (a table or tasks).

### 5.14 Presentations

```json
[{"op":"meta","layout":"grid","columns":3},
 {"op":"group","id":"s1","label":"1. 문제","slide":true,"layout":"grid","columns":1},
 {"op":"node","id":"s1t","label":"업무 맥락이 흩어져 있다","shape":"text","size":"xl","group":"s1"},
 {"op":"node","id":"s1b","label":"• 채널마다 다른 기록\n• 같은 질문의 반복","shape":"text","size":"l","group":"s1"},
 {"op":"group","id":"s2","label":"2. 해결","slide":true},
 {"op":"node","id":"a","label":"요청","kind":"user","group":"s2"},{"op":"node","id":"b","label":"허브","kind":"service","group":"s2"},
 {"op":"edge","from":"a","to":"b"}]
```

Slides are frames in reading order; one message per slide, little text; a slide
holding a diagram lays it out as a diagram. `export --ids s2` exports one slide.

### 5.15 Game design

- **Brainstorming / pitch board**: §5.13 with the game's key features; an **inspiration board** is `image` blocks and stickies in a grid.
- **Lo-fi prototype**: `sketch` theme, `sketch` blocks and stickies.
- **Mechanics**: core loop as a cycle of nodes, systems as flowcharts, combat or matchmaking states as a state machine (§5.5.2), an economy as a DFD of resources (§5.2), classes of entities as a class diagram (§5.5.1).
- **World and level design**: a `sketch` block — rooms as `rect`s with `text`, corridors as `line`s, paths and rivers as `freedraw`, regions as `polygon`s — with notes from artists and writers on each region.
- **UI wireframing**: `wireframe` with `device: "game"` — HP/MP `progress` bars, `minimap`, `slots` for the inventory or skill bar, menus as `list`s.
- **Narrative**: a dialogue tree with `layout: "tree"` — lines as nodes, player choices as `diamond`s, edges labelled with the condition; a story map as lanes per act.
- **Project management**: a `timeline` for sprints, milestones and marketing.

```json
{"op":"wireframe","id":"hud","label":"전투 HUD","device":"game","fidelity":"low","items":[
  {"type":"row","items":[{"type":"progress","label":"HP","value":0.7,"color":"red"},{"type":"progress","label":"MP","value":0.4,"color":"blue"},{"type":"spacer"},{"type":"minimap","label":"미니맵"}]},
  {"type":"spacer","height":"l"},{"type":"spacer","height":"l"},
  {"type":"slots","items":["검","방패","포션"],"count":8,"columns":8}]}
```

### 5.16 Job interviews and hiring

- **System design interview**: a frame per part — "문제", "가정", "질문", then the candidate's architecture (§5.3) — set up before the call; interviewer feedback as notes on the parts of the drawing they concern.
- **UX whiteboard challenge**: frames for the problem, a persona (§5.11), the user flow (§5.1), the wireframes (§5.12).
- **Interviewer notes**: notes on the candidate's work, or a scorecard `table` (criterion × rating × evidence).
- **Hiring process**: a swimlane (§5.1) with lanes per role (recruiter, hiring manager, candidate), stages resume screening → intro call → technical interview → system design → debrief, owners and criteria in notes.
- **Candidate preparation**: a `profile` of the role, a list of talking points (`text` nodes), practice diagrams.

```json
[{"op":"meta","layout":"grid","columns":3},
 {"op":"group","id":"problem","label":"문제","frame":true,"layout":"grid","columns":1},
 {"op":"node","id":"pt","label":"Discord 같은 그룹 채팅을 설계하세요\n• 동시 접속 100만\n• 메시지 순서 보장","shape":"text","group":"problem"},
 {"op":"group","id":"assume","label":"가정","frame":true,"layout":"grid","columns":1},
 {"op":"node","id":"a1","label":"읽기:쓰기 = 10:1","shape":"sticky","group":"assume"},
 {"op":"group","id":"design","label":"설계","frame":true},
 {"op":"node","id":"gw","label":"Gateway","kind":"api","group":"design"},
 {"op":"node","id":"chat","label":"chat service","kind":"service","group":"design"},
 {"op":"node","id":"db","label":"messages","shape":"cylinder","group":"design","color":"yellow"},
 {"op":"edge","from":"gw","to":"chat"},{"op":"edge","from":"chat","to":"db"},
 {"op":"note","on":"chat","text":"면접관: 샤딩 기준을 물어볼 것","color":"pink"}]
```

### 5.17 Education

Explain a concept with a mind map or flowchart broken into small parts; put
lecture material on slides (§5.14); give an assignment as a frame with the task
and an empty frame beside it for the answer; link related plans with `link`.

## 6. Mermaid

`mermaid` turns these kinds into the ops above, editable by id afterwards:

| Mermaid | becomes |
| --- | --- |
| `flowchart` / `graph` | nodes, edges, groups (subgraphs) |
| `sequenceDiagram` | one `sequence` block: participants, actors, activations (`activate`, `+`/`-`), `create participant`, `destroy`, `-)` async, notes, loop/alt/opt/par/critical/break |
| `classDiagram` | cards (attributes, then methods) and UML arrows; `namespace` becomes a group |
| `erDiagram` | cards (attributes) and crow's-foot edges |
| `stateDiagram-v2` | states, start/end dots, composite states as groups, choice as a diamond |
| `mindmap` | a radial tree, one colour per branch |
| `gantt` | one `timeline` block (`dateFormat YYYY-MM-DD` only); `after` becomes a dependency arrow, `done`/`active`/`crit`/`milestone` carry over |
| `quadrantChart` | one `quadrant` block |

Ids come from the Mermaid names (a name with Hangul gets an ASCII id with a
short tag); `--prefix` namespaces them; `--print` shows the ops without drawing.
Mermaid is a shortcut, not the limit: anything it cannot say you write as ops.

## 7. Making it read well

- Ten to twenty-five boxes per diagram; split a bigger one into groups, frames or several plans.
- Colour means something: one colour per layer, team, branch or competitor, kept across charts, with a `legend` when it is not obvious.
- Titles: a `text` node with `size: "xl"`, or the block's `title`.
- Korean text measures and draws in the matching Hangul face in both themes; write labels in the owner's language.
- After every batch read the issues, `export`, and look at the image before you report.
