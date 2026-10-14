import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Excalidraw, restoreAppState } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { isOpError } from "./engine/ops";
import { CanvasSession } from "./session";

import type { RequestKind } from "./session";

const headless =
  new URLSearchParams(window.location.search).get("engine") === "headless";

type Hot = NonNullable<ImportMeta["hot"]>;

/**
 * Carries the canvas session over the dev server socket: the server sends the
 * scene file and agent requests, the page sends back every change.
 */
class Bridge {
  private session: CanvasSession;
  private disposers: (() => void)[] = [];

  constructor(
    api: ExcalidrawImperativeAPI,
    private hot: Hot,
    private onStatus: (status: string) => void,
  ) {
    this.session = new CanvasSession(api, {
      onSave: (scene) => hot.send("gx:scene", { scene }),
    });

    const on = (event: string, handler: (data: any) => void) => {
      hot.on(event, handler);
      this.disposers.push(() => hot.off(event, handler));
    };
    on("gx:load", (data) =>
      this.session.load(data.scene, { fresh: data.reason === "hello" }),
    );
    on("gx:scene", (data) => this.session.merge(data.scene));
    on("gx:req", (data) => this.handle(data));
    on("vite:ws:connect", () => this.hello());
    on("vite:ws:disconnect", () => {
      // the server may come back with a different file: wait for its load
      this.session.unload();
      onStatus("disconnected");
    });
    this.hello();
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.session.dispose();
  }

  private hello() {
    this.hot.send("gx:hello", { headless });
    this.onStatus("connected");
  }

  private async handle(req: {
    reqId: string;
    kind: RequestKind;
    payload: any;
  }) {
    const reply = (body: object) =>
      this.hot.send("gx:res", { reqId: req.reqId, ...body });
    try {
      reply({
        ok: true,
        result: await this.session.request(req.kind, req.payload),
      });
    } catch (error) {
      if (!isOpError(error)) {
        console.error(error);
      }
      reply({ ok: false, error: (error as Error).message });
    }
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
