/** @jsxImportSource @opentui/solid */
/**
 * The Quota panel in the session sidebar: the fork's minimal lines from
 * `view/minimal-sidebar.ts`, each segment in its color. Clicking "Quota" forces a refresh.
 */
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { minimalSidebarLines } from "../view/minimal-sidebar.js";
import type { Surface } from "../view/select.js";
import type { Line, Segment } from "../view/text.js";
import type { QuotaClient } from "./client.js";
import type { DisplaySettings } from "./display.js";
import { roleColor, segmentColor, type Theme } from "./theme.js";

/** What the quota window's Settings tabs tell the surfaces while you edit them. */
export type SurfaceEditing = {
  /** The provider or row id selected on the tab that edits `surface`; that surface marks it. */
  marked(surface: Surface): string | undefined;
  /** The Sidebar tab shows the panel expanded. */
  panelOpen(): boolean | undefined;
  /** A sidebar panel is on screen until the returned function runs. */
  sidebarShown(): () => void;
  sidebarOnScreen(): boolean;
  /** The Settings tab of `surface` is open. */
  tabOpen(surface: Surface): boolean;
};

/** What every always-on surface reads. */
export type SurfaceHost = {
  theme: () => Theme;
  /**
   * The saved display settings, or the draft while the Settings tabs edit it. Surfaces take
   * their words from here, so unsaved words show while you edit them.
   */
  display: () => DisplaySettings;
  quota: QuotaClient;
  editing: SurfaceEditing;
};

/** The names of a marked line take the accent color; bars and numbers keep theirs. */
const MARKED_ROLES: ReadonlySet<Segment["role"]> = new Set(["provider", "label", "statusName"]);

/** One line of a surface, each segment in its color. A marked line has a soft background. */
export function LineText(props: { line: Line; host: SurfaceHost; marked?: boolean }): JSX.Element {
  const theme = () => props.host.theme();
  const color = (segment: Segment) =>
    props.marked && MARKED_ROLES.has(segment.role)
      ? theme().text.action.primary.selected
      : segmentColor(theme(), props.host.display(), segment);
  return (
    <text
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      bg={props.marked ? theme().background.raised.high : undefined}
    >
      {props.line.segments.length === 0 ? " " : null}
      {props.line.segments.map((segment) => (
        <span
          style={{
            fg: color(segment),
            bold: segment.bold === true,
          }}
        >
          {segment.text}
        </span>
      ))}
    </text>
  );
}

export function SidebarPanel(props: { host: SurfaceHost; sessionID: string }): JSX.Element {
  const host = props.host;
  const stop = host.quota.watch(props.sessionID);
  onCleanup(stop);
  onCleanup(host.editing.sidebarShown());
  const [nowMs, setNowMs] = createSignal(Date.now());
  // Reset times count down between snapshots.
  const clock = setInterval(() => setNowMs(Date.now()), 60_000);
  onCleanup(() => clearInterval(clock));

  const display = () => host.display();
  const snapshot = () => host.quota.snapshot(props.sessionID);
  const lines = createMemo(() =>
    minimalSidebarLines({
      snapshot: snapshot(),
      settings: display(),
      nowMs: nowMs(),
    }),
  );
  const marked = () => host.editing.marked("sidebar");

  return (
    <Show when={display().sidebar.show}>
      <box flexDirection="column">
        <text
          fg={roleColor(host.theme(), display(), "title")}
          onMouseDown={() => void host.quota.refresh("manual", props.sessionID)}
          selectable={false}
        >
          <b>Quota</b>
        </text>
        <Show when={snapshot()} fallback={<text fg={host.theme().text.muted}>Loading quota…</text>}>
          {lines().map((line) => (
            <LineText line={line} host={host} marked={line.id !== "" && line.id === marked()} />
          ))}
        </Show>
      </box>
    </Show>
  );
}
