import {
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
} from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { describeScene } from "./describe";
import { fullLayout, incrementalLayout, placeNotes } from "./layout";
import { elementId, isAgentOwned, readModel } from "./model";
import { applyOps } from "./ops";
import {
  buildElements,
  loadFonts,
  measureEdgeLabel,
  measureNode,
  measureNote,
} from "./render";

import type { Size } from "./layout";
import type { Model } from "./model";
import type { Op } from "./ops";

const cloneModel = (model: Model): Model => ({
  meta: { ...model.meta },
  nodes: new Map([...model.nodes].map(([k, v]) => [k, { ...v }])),
  edges: new Map([...model.edges].map(([k, v]) => [k, { ...v }])),
  groups: new Map([...model.groups].map(([k, v]) => [k, { ...v }])),
  notes: new Map([...model.notes].map(([k, v]) => [k, { ...v }])),
});

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export type ApplyResult = {
  layout: "full" | "incremental";
  touched: string[];
  removed: string[];
  warnings: string[];
  description: string;
};

export class Engine {
  constructor(
    private api: ExcalidrawImperativeAPI,
    private opts: { follow: () => boolean },
  ) {}

  private live() {
    return this.api.getSceneElements();
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** One change at a time: a person's drag and an agent's ops never interleave. */
  apply(ops: Op[]): Promise<ApplyResult> {
    const run = () => this.applyNow(ops);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private async applyNow(ops: Op[]): Promise<ApplyResult> {
    const all =
      this.api.getSceneElementsIncludingDeleted() as readonly ExcalidrawElement[];
    const live = all.filter((e) => !e.isDeleted);
    const model = cloneModel(readModel(live));
    const outcome = applyOps(model, ops);
    // a node that changed may have changed size: its routes no longer fit
    for (const edge of model.edges.values()) {
      if (outcome.touched.has(edge.from) || outcome.touched.has(edge.to)) {
        edge.points = undefined;
      }
    }

    await loadFonts(model);

    const theme = model.meta.theme;
    const sizes = new Map<string, Size>();
    for (const node of model.nodes.values()) {
      sizes.set(node.id, measureNode(node, theme));
    }
    const edgeLabels = new Map<string, Size>();
    for (const edge of model.edges.values()) {
      if (edge.label) {
        edgeLabels.set(edge.id, measureEdgeLabel(edge.label, theme));
      }
    }
    const noteSizes = new Map<string, Size>();
    for (const note of model.notes.values()) {
      noteSizes.set(
        note.id,
        note.width !== undefined && note.height !== undefined
          ? { width: note.width, height: note.height }
          : measureNote(note.text, theme),
      );
    }

    const handPlaced =
      [...model.nodes.values()].some((n) => n.pinned) ||
      [...model.groups.values()].some((g) => g.pinned);
    let layout: ApplyResult["layout"];
    if (outcome.layout) {
      await fullLayout(model, sizes, edgeLabels, outcome.layout);
      layout = "full";
    } else if (!handPlaced) {
      // nobody has arranged anything by hand yet: keep the whole drawing tidy
      await fullLayout(model, sizes, edgeLabels, { keepPinned: false });
      layout = "full";
    } else {
      incrementalLayout(model, sizes);
      layout = "incremental";
    }
    placeNotes(model, noteSizes, edgeLabels);

    const previous = new Map(
      all.filter((e) => isAgentOwned(e)).map((e) => [e.id, e]),
    );
    const { elements: agent, warnings } = buildElements(model, previous);
    const next = new Set(agent.map((e) => e.id));
    const tombstones = [...previous.values()]
      .filter((e) => !next.has(e.id) && !e.isDeleted)
      .map((e) => ({
        ...e,
        isDeleted: true,
        version: e.version + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
      }));
    const others = all.filter((e) => !isAgentOwned(e));

    this.api.updateScene({
      elements: [...agent, ...others, ...tombstones] as ExcalidrawElement[],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    if (this.opts.follow() && outcome.touched.size) {
      this.fit();
    }

    return {
      layout,
      touched: [...outcome.touched],
      removed: [...outcome.removed],
      warnings: [...outcome.warnings, ...warnings],
      description: describeScene([...agent, ...others]).text,
    };
  }

  describe() {
    return describeScene(this.live());
  }

  fit(ids?: string[]) {
    const live = this.live();
    const wanted = ids?.length
      ? live.filter((e) => this.matches(e, ids))
      : live.filter((e) => isAgentOwned(e));
    const target = wanted.length ? wanted : live;
    if (!target.length) {
      return { fitted: 0 };
    }
    // wait one frame so a scene update made just before has been rendered
    requestAnimationFrame(() =>
      this.api.setViewport({ target, fit: "scale-down", animation: true }),
    );
    return { fitted: target.length };
  }

  /** Agent ids name a node/edge/group/note; raw element ids are accepted too. */
  private matches(
    e: ExcalidrawElement | NonDeletedExcalidrawElement,
    ids: string[],
  ) {
    return ids.some(
      (id) =>
        e.id === id ||
        e.id === elementId.node(id) ||
        e.id === elementId.nodeLabel(id) ||
        e.id === elementId.edge(id) ||
        e.id === elementId.edgeLabel(id) ||
        e.id === elementId.group(id) ||
        e.id === elementId.groupLabel(id) ||
        e.id === elementId.note(id) ||
        e.id === elementId.noteLabel(id) ||
        e.id === elementId.noteLink(id),
    );
  }

  async export(opts: {
    format: "png" | "svg";
    ids?: string[];
    scale?: number;
    dark?: boolean;
    padding?: number;
  }) {
    const live = this.live();
    let elements = live;
    if (opts.ids?.length) {
      elements = live.filter((e) => this.matches(e, opts.ids!));
      // the members of an exported group come with it
      const groups = new Set(opts.ids);
      const model = readModel(live);
      const inGroup = (g?: string): boolean =>
        !!g && (groups.has(g) || inGroup(model.groups.get(g)?.parent));
      const members = [...model.nodes.values()]
        .filter((n) => inGroup(n.group))
        .map((n) => n.id);
      if (members.length) {
        elements = live.filter((e) =>
          this.matches(e, [...opts.ids!, ...members]),
        );
      }
      if (!elements.length) {
        throw new Error(`nothing on the canvas matches ${opts.ids.join(", ")}`);
      }
    }
    const appState = {
      ...this.api.getAppState(),
      exportBackground: true,
      exportWithDarkMode: !!opts.dark,
      exportScale: opts.scale ?? 2,
    };
    const files = this.api.getFiles();
    const padding = opts.padding ?? 24;
    if (opts.format === "svg") {
      const svg = await exportToSvg({
        elements,
        appState,
        files,
        exportPadding: padding,
      });
      return { format: "svg", data: svg.outerHTML, encoding: "utf8" };
    }
    const blob = await exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      exportPadding: padding,
    });
    return {
      format: "png",
      data: await blobToBase64(blob),
      encoding: "base64",
    };
  }
}
