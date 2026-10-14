import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  CaptureUpdateAction,
  Excalidraw,
  hashElementsVersion,
  reconcileElements,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";

import { Engine } from "./engine/engine";
import { needsSettling } from "./engine/model";
import { isOpError } from "./engine/ops";

const headless =
  new URLSearchParams(window.location.search).get("engine") === "headless";

type Hot = NonNullable<ImportMeta["hot"]>;

const SAVE_DEBOUNCE_MS = 250;

/**
 * Keeps this page and the scene file in step, and runs the agent's requests.
 */
class Bridge {
  private engine: Engine;
  private knownHash: number | null = null;
  /** nothing is saved until the file's scene has been applied here */
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUserActivity = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private api: ExcalidrawImperativeAPI,
    private hot: Hot,
    private onStatus: (status: string) => void,
  ) {
    // follow the agent's drawing unless the person is busy on the canvas
    this.engine = new Engine(api, {
      follow: () => Date.now() - this.lastUserActivity > 4000,
    });

    const on = (event: string, handler: (data: any) => void) => {
      hot.on(event, handler);
      this.disposers.push(() => hot.off(event, handler));
    };
    on("gx:load", (data) => this.load(data.scene, data.reason));
    on("gx:scene", (data) => this.merge(data.scene));
    on("gx:req", (data) => this.handle(data));
    on("vite:ws:connect", () => this.hello());
    on("vite:ws:disconnect", () => {
      // the server may come back with a different file: wait for its load
      this.loaded = false;
      onStatus("disconnected");
    });

    this.disposers.push(
      api.onChange((elements, appState, files) =>
        this.changed(elements, appState, files),
      ),
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
    this.hello();
  }

  dispose() {
    this.disposers.forEach((d) => d());
  }

  private hello() {
    this.hot.send("gx:hello", { headless });
    this.onStatus("connected");
  }

  private parse(text: string) {
    const data = JSON.parse(text);
    return {
      elements: restoreElements(data.elements ?? [], null, {
        repairBindings: true,
      }),
      appState: data.appState ?? {},
      files: (data.files ?? {}) as BinaryFiles,
    };
  }

  private load(text: string, reason: string) {
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
      captureUpdate:
        reason === "hello"
          ? CaptureUpdateAction.NEVER
          : CaptureUpdateAction.IMMEDIATELY,
    });
    if (reason === "hello" && elements.length) {
      requestAnimationFrame(() =>
        this.api.setViewport({
          target: elements.filter((e) => !e.isDeleted),
          fit: "scale-down",
          animation: false,
        }),
      );
    }
  }

  private merge(text: string) {
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

  private changed(
    elements: readonly ExcalidrawElement[],
    _appState: AppState,
    _files: BinaryFiles,
  ) {
    if (!this.loaded) {
      return;
    }
    const hash = hashElementsVersion(elements);
    if (hash === this.knownHash) {
      return;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  /** Sends the current scene to be written to the file. */
  private save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.loaded) {
      return;
    }
    const elements = this.api.getSceneElementsIncludingDeleted();
    this.knownHash = hashElementsVersion(elements);
    const appState = this.api.getAppState();
    const scene = serializeAsJSON(
      elements.filter((e) => !e.isDeleted),
      appState,
      this.api.getFiles(),
      "local",
    );
    this.hot.send("gx:scene", { scene: `${scene}\n` });
  }

  private async handle(req: { reqId: string; kind: string; payload: any }) {
    const reply = (body: object) =>
      this.hot.send("gx:res", { reqId: req.reqId, ...body });
    try {
      let result: unknown;
      switch (req.kind) {
        case "apply":
          result = await this.engine.apply(req.payload.ops ?? []);
          // wait for the editor to commit, then persist before answering
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          this.save();
          break;
        case "mermaid":
          result = await this.engine.mermaid(
            req.payload.definition ?? "",
            req.payload,
          );
          if (!req.payload.print) {
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            this.save();
          }
          break;
        case "describe":
          result = this.engine.describe();
          break;
        case "export":
          result = await this.engine.export(req.payload);
          break;
        case "fit":
          result = this.engine.fit(req.payload.ids);
          break;
        case "undo":
          result = this.undo();
          break;
        default:
          throw new Error(`unknown request "${req.kind}"`);
      }
      reply({ ok: true, result });
    } catch (error) {
      if (!isOpError(error)) {
        console.error(error);
      }
      reply({ ok: false, error: (error as Error).message });
    }
  }

  private undo() {
    // the editor's own undo: the agent's last batch was one history entry
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="button-undo"]',
    );
    if (!button || button.disabled) {
      throw new Error("nothing to undo");
    }
    button.click();
    setTimeout(() => this.save(), 50);
    return { undone: true };
  }
}

const StatusBadge = ({ status }: { status: string }) => (
  <div
    style={{
      position: "fixed",
      left: 12,
      bottom: 64,
      zIndex: 10,
      font: "12px system-ui, sans-serif",
      padding: "4px 8px",
      borderRadius: 6,
      background: status === "connected" ? "#d3f9d8" : "#ffe3e3",
      color: "#1e1e1e",
      pointerEvents: "none",
      opacity: 0.85,
    }}
  >
    agent canvas: {status}
  </div>
);

const App = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState("connecting");
  const bridge = useRef<Bridge | null>(null);

  useEffect(() => {
    if (!api || !import.meta.hot) {
      return;
    }
    bridge.current = new Bridge(api, import.meta.hot, setStatus);
    // for scripted checks of the canvas (tests, a person in the devtools)
    (window as unknown as { gexcal: object }).gexcal = { api };
    return () => {
      bridge.current?.dispose();
      bridge.current = null;
    };
  }, [api]);

  return (
    <>
      <Excalidraw
        onExcalidrawAPI={setApi}
        initialData={{
          appState: restoreAppState({ viewBackgroundColor: "#ffffff" }, null),
        }}
      />
      {!headless && <StatusBadge status={status} />}
    </>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
