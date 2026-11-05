/** @jsxImportSource @opentui/solid */
/**
 * The body of the quota window's Limits tab. Its text comes from the pure builder `limits.ts`;
 * the view only colors it.
 */
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import { LineText, type SurfaceHost } from "../sidebar.js";
import { limitsLines } from "./limits.js";

export function LimitsView(props: {
  host: SurfaceHost;
  sessionID: string;
  nowMs: number;
  width: number;
}): JSX.Element {
  const snapshot = () => props.host.quota.snapshot(props.sessionID);
  const lines = () => {
    const current = snapshot();
    if (!current) return [];
    const display = props.host.display();
    return limitsLines({ snapshot: current, display, nowMs: props.nowMs, width: props.width });
  };
  return (
    <Show
      when={snapshot()}
      fallback={<text fg={props.host.theme().text.muted}>{"   Loading quota…"}</text>}
    >
      {lines().map((line) => (
        <LineText line={line} host={props.host} />
      ))}
    </Show>
  );
}
