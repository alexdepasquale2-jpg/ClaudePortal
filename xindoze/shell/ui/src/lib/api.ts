/**
 * The contract between the Canvas and the Xindoze runtime.
 *
 * Types mirror the JSON that `crates/types` (serde) and the shell's
 * `src-tauri/src/runtime.rs` produce. Each function maps 1:1 to the Tauri
 * command named in its doc comment. Tauri maps camelCase argument keys to
 * snake_case Rust parameters, so `rewind(taskId)` reaches `fn rewind(task_id)`.
 *
 * Outside Tauri (`npm run dev` in a browser) every call goes to an in-browser
 * mock instead, so the UI is a usable demo without a runtime.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Shared shapes (crates/types)

/** Any JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Tool risk class (SPEC §3.2). */
export type Risk = 'observe' | 'act' | 'commit';

/** What actually happened to a tool call after the Warden and any confirmation. */
export type Verdict = 'allowed' | 'confirmed' | 'declined' | 'denied';

/** Model role (SPEC §3.6). */
export type Role = 'reflex' | 'cortex' | 'oracle' | 'embed' | 'vision';

/** Provenance of untrusted content. Serde omits `sources` when the value is clean. */
export interface Taint {
  sources?: string[];
}

/** A state change a tool made; Rewind undoes it. Tagged by `kind`. */
export type Effect =
  | { kind: 'file_created'; path: string }
  | { kind: 'file_modified'; path: string; pre: string }
  | { kind: 'file_moved'; from: string; to: string }
  | { kind: 'file_trashed'; path: string; trashed_to: string }
  | { kind: 'dir_created'; path: string }
  | { kind: 'kv_set'; ns: string; key: string; pre: Json }
  | { kind: 'irreversible'; note: string };

/** One step as shown on an action card. */
export interface StepRecord {
  tool: string;
  args: Json;
  verdict: Verdict;
  ok: boolean;
  summary: string;
}

/** The result of handling one intent. */
export interface Outcome {
  task_id: string;
  organism: string;
  say: string | null;
  ui: XuiNode | null;
  steps: StepRecord[];
  /** Crystal id when the fast path served the intent. */
  crystal: string | null;
  /** False when the step budget ran out before the planner said done. */
  done: boolean;
}

/** What the user is asked to approve. */
export interface AskInfo {
  organism: string;
  tool: string;
  args: Json;
  risk: Risk;
  reason: string;
  /** Where tainted inputs came from; shown prominently. */
  taint: Taint;
}

/** One Journal row: every tool call, allowed or not. */
export interface JournalEvent {
  seq: number;
  device: string;
  ts_ms: number;
  organism: string;
  task_id: string;
  tool: string;
  args: Json;
  risk: Risk;
  verdict: Verdict;
  taint: Taint;
  ok: boolean;
  summary: string;
  effects: Effect[];
  rewound: boolean;
}

// ---------------------------------------------------------------------------
// XUI (SPEC Appendix B, crates/types/src/xui.rs). Optional fields are the
// ones serde fills with a default when missing.

/** What a button does: route an intent, or call a tool through the Warden. */
export type Action = { intent: string } | { tool: string; args?: Json };

export type InputKind = 'text' | 'number' | 'date' | 'toggle';
export type ChartKind = 'bar' | 'line';

export interface Series {
  name: string;
  values: number[];
}

export type XuiNode =
  | { type: 'stack'; direction?: 'row' | 'col'; gap?: number | null; children?: XuiNode[] }
  | { type: 'heading'; text: string; level?: number }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'card'; title: string; children?: XuiNode[] }
  | { type: 'button'; label: string; action: Action }
  | { type: 'input'; label: string; kind: InputKind; bind: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'chart'; kind: ChartKind; x: string[]; series: Series[]; y?: string | null }
  | { type: 'progress'; value: number; max: number; label: string }
  | { type: 'rewind'; task_id: string };

export type XuiType = XuiNode['type'];

// ---------------------------------------------------------------------------
// Shell shapes (shell/src-tauri/src/runtime.rs)

/** Result of a UI-bound tool call. */
export interface ToolReply {
  content: Json;
}

/** What Rewind did, one human-readable line per effect. */
export interface RewindReport {
  undone: string[];
  skipped: string[];
  failed: string[];
}

export interface ModelStatus {
  role: Role;
  model: string;
  backend: string;
  loaded: boolean;
}

export interface PeerStatus {
  name: string;
  online: boolean;
}

export interface EgressEvent {
  host: string;
  ts_ms: number;
  allowed: boolean;
}

/** System health for the Pulse surface (SPEC §3.11). */
export interface Pulse {
  host: string;
  tier: string;
  models: ModelStatus[];
  tokens_per_sec: number;
  requests: number;
  peers: PeerStatus[];
  /** Recent egress attempts. Empty means zero egress. */
  egress: EgressEvent[];
  journal_count: number;
}

export interface GenomeInfo {
  id: string;
  version: string;
  purpose: string;
  ui: 'canvas' | 'none';
}

export type RuleDecision = 'allow' | 'ask' | 'deny';

export interface CharterRule {
  id: string;
  text: string;
  decision: RuleDecision;
}

export interface CharterView {
  rules: CharterRule[];
}

/** Payload of the `xz://ask` event. Answer it with {@link confirmReply}. */
export interface AskEvent {
  id: string;
  ask: AskInfo;
}

/** Payload of the `xz://step` event: a step of a running task, as it happens. */
export interface StepEvent {
  task_id: string;
  step: StepRecord;
}

// ---------------------------------------------------------------------------
// Transport

export const EVENT_ASK = 'xz://ask';
export const EVENT_STEP = 'xz://step';

export type EventName = typeof EVENT_ASK | typeof EVENT_STEP;

export type Command =
  | 'intent'
  | 'intent_for'
  | 'tool_call'
  | 'confirm_reply'
  | 'rewind'
  | 'pulse'
  | 'genomes'
  | 'journal'
  | 'charter'
  | 'blob'
  | 'open_url'
  | 'conquest'
  | 'set_conquest';

/** How calls reach a runtime: Tauri IPC, or the in-browser mock. */
export interface Transport {
  invoke<T>(cmd: Command, args?: Record<string, unknown>): Promise<T>;
  /** Resolves to an unsubscribe function. */
  listen<T>(event: EventName, handler: (payload: T) => void): Promise<() => void>;
}

/** True inside the Tauri webview. */
export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const tauri: Transport = {
  invoke: <T>(cmd: Command, args?: Record<string, unknown>) => tauriInvoke<T>(cmd, args),
  listen: <T>(event: EventName, handler: (payload: T) => void) =>
    tauriListen<T>(event, (e) => handler(e.payload)),
};

let transport: Promise<Transport> | undefined;

function rt(): Promise<Transport> {
  // The mock is a separate chunk so the Tauri build never loads it.
  transport ??= inTauri() ? Promise.resolve(tauri) : import('./mock').then((m) => m.createMock());
  return transport;
}

async function call<T>(cmd: Command, args?: Record<string, unknown>): Promise<T> {
  return (await rt()).invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Commands

/** `intent`: handle an intent from the Intent Bar (Prime routes it). */
export function intent(text: string): Promise<Outcome> {
  return call('intent', { text });
}

/** `intent_for`: handle an intent addressed to one Organism (its Canvas pane). */
export function intentFor(organism: string, text: string): Promise<Outcome> {
  return call('intent_for', { organism, text });
}

/** `tool_call`: a button bound to a tool. Still goes through the Warden. */
export function toolCall(organism: string, tool: string, args: Json): Promise<ToolReply> {
  return call('tool_call', { organism, tool, args });
}

/** `confirm_reply`: answer an `xz://ask`. */
export function confirmReply(id: string, approve: boolean): Promise<void> {
  return call('confirm_reply', { id, approve });
}

/** `rewind`: undo every reversible effect of a task. */
export function rewind(taskId: string): Promise<RewindReport> {
  return call('rewind', { taskId });
}

/** `pulse`: models, speed, peers and egress. */
export function pulse(): Promise<Pulse> {
  return call('pulse');
}

/** `genomes`: installed Genomes. */
export function genomes(): Promise<GenomeInfo[]> {
  return call('genomes');
}

/** `journal`: the newest `limit` Journal events, newest first. */
export function journal(limit: number): Promise<JournalEvent[]> {
  return call('journal', { limit });
}

/** `charter`: the Charter as plain-language rules. */
export function charter(): Promise<CharterView> {
  return call('charter');
}

/**
 * `blob`: resolve an XUI image's local blob ref to a `data:image/...` URL.
 * The Canvas never puts a model-supplied `src` into the page directly.
 */
export async function blob(ref: string): Promise<string | null> {
  const url = await call<string>('blob', { ref });
  return typeof url === 'string' && url.startsWith('data:image/') ? url : null;
}

/** `open_url`: open an http(s) link in the system browser, outside the Canvas. */
export function openUrl(url: string): Promise<void> {
  return call('open_url', { url });
}

/** Desktop conquest mode. `supported` is false on Android. */
export interface ConquestView {
  supported: boolean;
  mode: 'guest' | 'overlay' | 'takeover';
  undo: string;
}

/** `conquest`: current Guest / Overlay / Takeover mode. */
export function conquest(): Promise<ConquestView> {
  return call('conquest');
}

/** `set_conquest`: switch mode. Takeover installs a reversible login hook. */
export function setConquest(mode: ConquestView['mode']): Promise<ConquestView> {
  return call('set_conquest', { mode });
}

/** Subscribe to `xz://ask`. Resolves to an unsubscribe function. */
export async function onAsk(handler: (e: AskEvent) => void): Promise<() => void> {
  return (await rt()).listen(EVENT_ASK, handler);
}

/** Subscribe to `xz://step`. Resolves to an unsubscribe function. */
export async function onStep(handler: (e: StepEvent) => void): Promise<() => void> {
  return (await rt()).listen(EVENT_STEP, handler);
}

/** A readable message for a failed call. Tauri rejects with the command's error string. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return 'unknown error';
  }
}
