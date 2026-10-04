import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin from "../src/tui-v2.tsx";

const REFRESH_INTERVAL_MS = 60_000;

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// Canned answers of the server plugin's quota RPC.
const rpc = {
  surface: vi.fn(),
  command: vi.fn(),
};
const client = { rpc: vi.fn(() => rpc) };

function setupSlots(
  handlers = new Map<string, (event: unknown) => void>(),
): Map<string, (props?: any) => unknown> {
  const renderers = new Map<string, (props?: any) => unknown>();
  plugin.setup({
    client,
    theme: { text: { base: "base", muted: "muted" } },
    data: {
      location: { default: () => ({ directory: "/work/default" }) },
      on: vi.fn((event: string, handler: (event: unknown) => void) => {
        handlers.set(event, handler);
        return vi.fn();
      }),
      session: {
        get: (sessionID: string) =>
          sessionID === "ses_child" ? { parentID: "ses_parent" } : { id: sessionID },
      },
    },
    keymap: { layer: vi.fn() },
    ui: {
      slot: vi.fn((claim) => {
        renderers.set(claim.append, claim.render);
        return vi.fn();
      }),
      toast: { show: vi.fn() },
      dialog: { show: vi.fn(), clear: vi.fn(), prompt: vi.fn(), set: vi.fn() },
    },
  } as any);
  return renderers;
}

function mountSlot(render: ((props?: any) => unknown) | undefined, props?: unknown): () => void {
  return createRoot((dispose) => {
    render?.(props);
    return dispose;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("V2 sidebar refresh timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("React", {
      createElement: (type: unknown, props: Record<string, unknown> | null) =>
        typeof type === "function" ? type(props ?? {}) : { type, props },
    });
    rpc.surface.mockReset().mockResolvedValue({ quota: { message: "Copilot 50%" } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes the sidebar every minute until unmount", async () => {
    const renderers = setupSlots();
    const dispose = mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(rpc.surface).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(2);

    dispose();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(2);
  });

  it("loads the sidebar for the session its host passes in", async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const renderers = setupSlots(handlers);
    const dispose = mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_2" });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(1);
    expect(rpc.surface.mock.calls[0][0]).toEqual({ surface: "sidebar", sessionID: "ses_2" });

    handlers.get("session.step.ended")?.({ data: { sessionID: "ses_1" } });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(1);

    handlers.get("session.step.ended")?.({ data: { sessionID: "ses_2" } });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(2);
    expect(rpc.surface.mock.calls[1][0]).toEqual({ surface: "sidebar", sessionID: "ses_2" });
    dispose();
  });

  it("calls the RPC at the TUI location with a one-minute timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const renderers = setupSlots();
    expect(client.rpc).not.toHaveBeenCalled();
    const dispose = mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" });
    await flushPromises();

    const { QuotaRpc } = await import("../src/rpc.js");
    expect(client.rpc).toHaveBeenCalledWith(QuotaRpc);
    expect(rpc.surface.mock.calls).toHaveLength(1);
    const [, options] = rpc.surface.mock.calls[0];
    expect(options).toEqual({
      location: { directory: "/work/default" },
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(60_000);
    dispose();
  });

  it("logs a failed load with the RPC error message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.surface.mockRejectedValueOnce({ type: "rpc.internal", message: "server broke" });
    rpc.surface.mockRejectedValueOnce({ type: "rpc.unavailable", message: "no rpc" });
    const renderers = setupSlots();
    mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" })();
    mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" })();
    await flushPromises();

    expect(warn.mock.calls).toEqual([
      ["[opencode-quota] failed to load quota: server broke"],
      [
        "[opencode-quota] failed to load quota: no rpc (OpenCode Quota's server plugin is not loaded for this folder)",
      ],
    ]);
  });

  it("coalesces refreshes that arrive while a sidebar load is running into one follow-up load", async () => {
    const load = deferred<unknown>();
    rpc.surface.mockReturnValueOnce(load.promise);
    const handlers = new Map<string, (event: unknown) => void>();
    const renderers = setupSlots(handlers);
    const dispose = mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" });
    await flushPromises();

    handlers.get("session.step.ended")?.({ data: { sessionID: "ses_1" } });
    handlers.get("session.step.ended")?.({ data: { sessionID: "ses_1" } });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(1);

    load.resolve({ quota: null });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("stops sidebar refreshes and drops their results after unmount", async () => {
    const load = deferred<unknown>();
    rpc.surface.mockReturnValueOnce(load.promise);
    const handlers = new Map<string, (event: unknown) => void>();
    const renderers = setupSlots(handlers);
    const dispose = mountSlot(renderers.get("sidebar.content"), { sessionID: "ses_1" });
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledExactlyOnceWith(
      { surface: "sidebar", sessionID: "ses_1" },
      expect.anything(),
    );

    handlers.get("session.step.ended")?.({ data: { sessionID: "ses_1" } });
    dispose();
    load.resolve({ quota: null });
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    await flushPromises();
    expect(rpc.surface).toHaveBeenCalledTimes(1);
  });
});
