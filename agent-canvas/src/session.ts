// One canvas's link to its scene file and to the agent, whatever carries the
// messages: the dev server's socket (main.tsx) or a host page that embeds the
// canvas (embed.tsx). The host hands scenes in with `load`/`merge`, receives
// every change through `onSave`, and passes agent requests to `request`.

import {
  CaptureUpdateAction,
  hashElementsVersion,
  reconcileElements,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";

import { Engine } from "./engine/engine";
import { needsSettling } from "./engine/model";

const SAVE_DEBOUNCE_MS = 250;
/** a person who touched the canvas this recently is not followed around */
const FOLLOW_IDLE_MS = 4000;

export type RequestKind =
  | "apply"
  | "mermaid"
  | "describe"
  | "export"
  | "fit"
  | "undo";

export type SessionHooks = {
  /** the scene as it should be written to the file */
  onSave: (scene: string) => void;
  /** where the editor is mounted (its undo button is looked up inside) */
  root?: ParentNode;
};

export class CanvasSession {
  private engine: Engine;
  private knownHash: number | null = null;
  /** nothing is saved until the file's scene has been applied here */
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUserActivity = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private api: ExcalidrawImperativeAPI,
    private hooks: SessionHooks,
  ) {
    // follow the agent's drawing unless the person is busy on the canvas
    this.engine = new Engine(api, {
      follow: () => Date.now() - this.lastUserActivity > FOLLOW_IDLE_MS,
    });
    this.disposers.push(
      api.onChange((elements) => this.changed(elements)),
      api.onPointerDown(() => {
        this.lastUserActivity = Date.now();
      }),
      api.onPointerUp(() => {
        this.lastUserActivity = Date.now();
        // a group box was dragged (its contents follow) or a box was placed
        // by hand for the first time (its arrows get re-routed)
        setTimeout(() => {
          if (needsSettling(this.api.getSceneElements())) {
            this.engine
              .apply([])
              .then(() => this.save())
              .catch((error) => console.error(error));
          }
        }, 0);
      }),
    );
  }

  dispose() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.disposers.forEach((d) => d());
  }

  /** the scene no longer stands for a file (connection lost, file closed) */
  unload() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.loaded = false;
  }

  private parse(text: string) {
    const data = text.trim() ? JSON.parse(text) : {};
    return {
      elements: restoreElements(data.elements ?? [], null, {
        repairBindings: true,
      }),
      appState: data.appState ?? {},
      files: (data.files ?? {}) as BinaryFiles,
    };
  }

  /**
   * Shows a scene as the file's content. `fresh` is a file just opened: it is
   * not an undoable step and the view moves to it.
   */
  load(text: string, { fresh = false } = {}) {
    const { elements, appState, files } = this.parse(text);
    this.knownHash = hashElementsVersion(elements);
    this.loaded = true;
    if (Object.keys(files).length) {
      this.api.addFiles(Object.values(files));
    }
    this.api.updateScene({
      elements,
      appState: {
        viewBackgroundColor:
          appState.viewBackgroundColor ??
          this.api.getAppState().viewBackgroundColor,
      },
      captureUpdate: fresh
        ? CaptureUpdateAction.NEVER
        : CaptureUpdateAction.IMMEDIATELY,
    });
    if (fresh) {
      this.api.history.clear();
      const live = elements.filter((e) => !e.isDeleted);
      if (live.length) {
        requestAnimationFrame(() =>
          this.api.setViewport({
            target: live,
            fit: "scale-down",
            animation: false,
          }),
        );
      }
    }
  }

  /** Folds a scene written elsewhere into what is on the canvas. */
  merge(text: string) {
    const { elements, files } = this.parse(text);
    const local = this.api.getSceneElementsIncludingDeleted();
    const merged = reconcileElements(
      local,
      elements as unknown as RemoteExcalidrawElement[],
      this.api.getAppState(),
    );
    this.knownHash = hashElementsVersion(merged);
    if (Object.keys(files).length) {
      this.api.addFiles(Object.values(files));
    }
    this.api.updateScene({
      elements: merged,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  private changed(elements: readonly { id: string }[]) {
    if (!this.loaded) {
      return;
    }
    const hash = hashElementsVersion(elements as never);
    if (hash === this.knownHash) {
      return;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  /** The scene as the file holds it. */
  scene() {
    const elements = this.api
      .getSceneElementsIncludingDeleted()
      .filter((e) => !e.isDeleted);
    return `${serializeAsJSON(
      elements,
      this.api.getAppState(),
      this.api.getFiles(),
      "local",
    )}\n`;
  }

  /** Hands the current scene to be written to the file. */
  save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.loaded) {
      return;
    }
    this.knownHash = hashElementsVersion(
      this.api.getSceneElementsIncludingDeleted(),
    );
    this.hooks.onSave(this.scene());
  }

  /** Runs one agent request; a refused request throws with the reason. */
  async request(kind: RequestKind, payload: any = {}): Promise<unknown> {
    switch (kind) {
      case "apply": {
        const result = await this.engine.apply(payload.ops ?? []);
        await this.committed();
        return result;
      }
      case "mermaid": {
        const result = await this.engine.mermaid(
          payload.definition ?? "",
          payload,
        );
        if (!payload.print) {
          await this.committed();
        }
        return result;
      }
      case "describe":
        return this.engine.describe();
      case "export":
        return this.engine.export(payload);
      case "fit":
        return this.engine.fit(payload.ids);
      case "undo":
        return this.undo();
      default:
        throw new Error(`unknown request "${kind}"`);
    }
  }

  /** waits for the editor to commit a change, then persists it */
  private async committed() {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    this.save();
  }

  private undo() {
    // the editor's own undo: the agent's last batch was one history entry
    const button = (
      this.hooks.root ?? document
    ).querySelector<HTMLButtonElement>('[data-testid="button-undo"]');
    if (!button || button.disabled) {
      throw new Error("nothing to undo");
    }
    button.click();
    setTimeout(() => this.save(), 50);
    return { undone: true };
  }
}
