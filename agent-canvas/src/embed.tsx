// The canvas as a component another application mounts: no server, no socket.
// The host page owns the file (it loads the scene in and writes what
// `onSave` hands it) and relays agent requests to `request`. Built into one
// ES module by `vite.embed.config.mts`, React included, so a host that does
// not use React needs nothing else.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Excalidraw, restoreAppState } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { isOpError } from "./engine/ops";
import { CanvasSession } from "./session";

import type { RequestKind } from "./session";

export type Theme = "light" | "dark";

export type PlanCanvasOptions = {
  theme?: Theme;
  /** an Excalidraw locale code, e.g. "ko-KR" */
  langCode?: string;
  /** every change to the scene, debounced, as the file should hold it */
  onSave?: (scene: string) => void;
};

export type RequestResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export type PlanCanvas = {
  /** shows a file's content; `fresh` for a file just opened */
  load: (scene: string, options?: { fresh?: boolean }) => void;
  /** folds in a version written elsewhere */
  merge: (scene: string) => void;
  /** the scene as the file should hold it now */
  scene: () => string;
  /** writes any pending change through `onSave` at once */
  flush: () => void;
  /** stops saving until the next `load` (the file was closed) */
  unload: () => void;
  /** runs one agent request: apply, mermaid, describe, export, fit, undo */
  request: (kind: RequestKind, payload?: unknown) => Promise<RequestResult>;
  setTheme: (theme: Theme) => void;
  dispose: () => void;
};

type Shell = {
  theme: Theme;
  langCode: string;
  onApi: (api: ExcalidrawImperativeAPI | null) => void;
  onTheme: (set: (theme: Theme) => void) => void;
};

const Canvas = ({ theme: initialTheme, langCode, onApi, onTheme }: Shell) => {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => onTheme(setTheme), [onTheme]);
  return (
    <Excalidraw
      onExcalidrawAPI={onApi}
      theme={theme}
      langCode={langCode}
      initialData={{
        appState: restoreAppState({ viewBackgroundColor: "#ffffff" }, null),
      }}
      UIOptions={{
        canvasActions: {
          // the host owns the file: opening another one or saving to disk
          // from inside the canvas would bypass it
          loadScene: false,
          saveToActiveFile: false,
        },
      }}
    />
  );
};

/** Mounts the canvas into `element`; resolves once the editor is ready. */
export const mountPlanCanvas = (
  element: HTMLElement,
  options: PlanCanvasOptions = {},
): Promise<PlanCanvas> =>
  new Promise((resolve) => {
    const root = createRoot(element);
    let setTheme: ((theme: Theme) => void) | null = null;
    let session: CanvasSession | null = null;

    const onApi = (api: ExcalidrawImperativeAPI | null) => {
      if (!api || session) {
        return;
      }
      session = new CanvasSession(api, {
        onSave: (scene) => options.onSave?.(scene),
        root: element,
      });
      const live = session;
      resolve({
        load: (scene, opts) => live.load(scene, opts),
        merge: (scene) => live.merge(scene),
        scene: () => live.scene(),
        flush: () => live.save(),
        unload: () => live.unload(),
        request: async (kind, payload) => {
          try {
            return { ok: true, result: await live.request(kind, payload) };
          } catch (error) {
            if (!isOpError(error)) {
              console.error(error);
            }
            return { ok: false, error: (error as Error).message };
          }
        },
        setTheme: (theme) => setTheme?.(theme),
        dispose: () => {
          live.dispose();
          root.unmount();
        },
      });
    };

    root.render(
      <StrictMode>
        <Canvas
          theme={options.theme ?? "light"}
          langCode={options.langCode ?? "en"}
          onApi={onApi}
          onTheme={(set) => {
            setTheme = set;
          }}
        />
      </StrictMode>,
    );
  });
