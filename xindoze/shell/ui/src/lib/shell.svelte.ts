/**
 * Canvas state: the Stream, pending asks, Organism panes and system panels.
 * One instance (`shell`) is shared by every component.
 */

import * as api from './api';
import { cue } from './cues';
import type {
  AskEvent,
  CharterRule,
  GenomeInfo,
  JournalEvent,
  Json,
  Outcome,
  Pulse,
  RewindReport,
  StepEvent,
  StepRecord,
  XuiNode,
} from './api';

export type View = 'stream' | 'canvas' | 'system';

export interface TaskEntry {
  kind: 'task';
  key: number;
  /** Null until the first step or the outcome names it. */
  taskId: string | null;
  steps: StepRecord[];
  outcome: Outcome | null;
  error: string | null;
}

export type Entry =
  | { kind: 'boot'; key: number }
  | { kind: 'intent'; key: number; text: string; organism: string | null }
  | TaskEntry;

export interface PendingAsk extends AskEvent {
  busy: boolean;
  error: string | null;
}

/** Values of a pane's input nodes, keyed by their `bind`. */
export type Binds = Record<string, string | number | boolean>;

export interface Pane {
  organism: string;
  ui: XuiNode;
  taskId: string;
  binds: Binds;
  /** Result of the last UI-bound tool call, read out politely. */
  status: string;
}

const HISTORY_MAX = 50;
const JOURNAL_LIMIT = 30;
const PULSE_EVERY_MS = 5000;
/** Below this width the Canvas shows one view at a time (keep in sync with app.css). */
const NARROW = '(max-width: 1099px)';

class Shell {
  entries = $state<Entry[]>([{ kind: 'boot', key: 0 }]);
  asks = $state<PendingAsk[]>([]);
  panes = $state<Pane[]>([]);
  activePane = $state<string | null>(null);
  view = $state<View>('stream');
  narrow = $state(false);
  pulse = $state<Pulse | null>(null);
  genomes = $state<GenomeInfo[]>([]);
  rules = $state<CharterRule[]>([]);
  journal = $state<JournalEvent[]>([]);
  /** Short status read out by a polite live region. */
  announcement = $state('');
  /** Sent intents, oldest first, for Up-arrow recall. */
  readonly history: string[] = [];
  #key = 1;

  /** Subscribes to runtime events and starts polling. Returns a cleanup function. */
  start(): () => void {
    const media = window.matchMedia(NARROW);
    const onMedia = () => (this.narrow = media.matches);
    onMedia();
    media.addEventListener('change', onMedia);

    let stopped = false;
    const unlisten: (() => void)[] = [];
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (stopped ? u() : unlisten.push(u))).catch(() => {});
    keep(api.onAsk((e) => this.#onAsk(e)));
    keep(api.onStep((e) => this.#onStep(e)));

    cue('boot-evolved');
    void this.refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void this.refreshPulse();
    }, PULSE_EVERY_MS);

    return () => {
      stopped = true;
      media.removeEventListener('change', onMedia);
      window.clearInterval(timer);
      unlisten.forEach((u) => u());
    };
  }

  /** Sends an intent to Prime, or to one Organism when `organism` is set. */
  async send(text: string, organism: string | null = null): Promise<void> {
    const t = text.trim();
    if (!t) return;
    if (this.history[this.history.length - 1] !== t) this.history.push(t);
    if (this.history.length > HISTORY_MAX) this.history.shift();

    cue('intent-sent');
    this.entries.push({ kind: 'intent', key: this.#key++, text: t, organism });
    this.entries.push({
      kind: 'task',
      key: this.#key++,
      taskId: null,
      steps: [],
      outcome: null,
      error: null,
    });
    // Mutate through the state proxy, not the plain object pushed above.
    const entry = this.entries[this.entries.length - 1] as TaskEntry;
    try {
      const out = organism ? await api.intentFor(organism, t) : await api.intent(t);
      entry.taskId = out.task_id;
      entry.steps = out.steps;
      entry.outcome = out;
      if (out.ui) this.#showUi(out.organism, out.ui, out.task_id);
      const blocked = out.steps.some((s) => s.verdict === 'denied' || s.verdict === 'declined');
      cue(blocked ? 'deny' : out.done ? 'task-done' : 'notification');
    } catch (e) {
      entry.error = api.errorText(e);
      cue('error');
    }
    void this.refresh();
  }

  /** Answers a pending ask. */
  async reply(id: string, approve: boolean): Promise<void> {
    const ask = this.asks.find((a) => a.id === id);
    if (!ask || ask.busy) return;
    ask.busy = true;
    ask.error = null;
    try {
      await api.confirmReply(id, approve);
      this.asks = this.asks.filter((a) => a.id !== id);
      this.announcement = `${approve ? 'Approved' : 'Declined'} ${ask.ask.tool}.`;
    } catch (e) {
      ask.busy = false;
      ask.error = api.errorText(e);
      cue('error');
    }
  }

  /** Undoes a task. Throws when the runtime fails. */
  async rewind(taskId: string): Promise<RewindReport> {
    cue('rewind');
    try {
      return await api.rewind(taskId);
    } finally {
      void this.refresh();
    }
  }

  /** Runs a tool bound to a pane's button; declared args win over bound inputs. */
  async runTool(pane: Pane, tool: string, args: Json | undefined): Promise<void> {
    const declared = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    pane.status = `Running ${tool}…`;
    try {
      const reply = await api.toolCall(pane.organism, tool, { ...pane.binds, ...declared });
      pane.status = describeContent(reply.content) || `${tool} done.`;
    } catch (e) {
      pane.status = `${tool} didn't finish: ${api.errorText(e)}`;
    }
    void this.refresh();
  }

  /** Shows a pane, switching to the Canvas view on narrow screens. */
  openPane(organism: string): void {
    this.activePane = organism;
    if (this.narrow) this.view = 'canvas';
  }

  /** Reloads every system panel; failures keep the previous values. */
  async refresh(): Promise<void> {
    await Promise.allSettled([
      this.refreshPulse(),
      api.genomes().then((g) => (this.genomes = g)),
      api.charter().then((c) => (this.rules = c.rules)),
      api.journal(JOURNAL_LIMIT).then((j) => (this.journal = j)),
    ]);
  }

  async refreshPulse(): Promise<void> {
    try {
      const next = await api.pulse();
      const before = this.pulse;
      if (before) {
        const was = new Set(before.peers.filter((p) => p.online).map((p) => p.name));
        const now = new Set(next.peers.filter((p) => p.online).map((p) => p.name));
        if ([...now].some((name) => !was.has(name))) cue('hive-connect');
        if ([...was].some((name) => !now.has(name))) cue('hive-disconnect');
      }
      this.pulse = next;
    } catch {
      // Keep the last reading; the next poll retries.
    }
  }

  #showUi(organism: string, ui: XuiNode, taskId: string) {
    const pane = this.panes.find((p) => p.organism === organism);
    if (pane) {
      pane.ui = ui;
      pane.taskId = taskId;
      pane.binds = {};
      pane.status = '';
    } else {
      this.panes.push({ organism, ui, taskId, binds: {}, status: '' });
    }
    this.openPane(organism);
  }

  #onAsk(e: AskEvent) {
    this.asks.push({ ...e, busy: false, error: null });
    this.announcement = `Approval needed: ${e.ask.organism} wants to run ${e.ask.tool}.`;
    cue('warden-ask');
  }

  #onStep({ task_id, step }: StepEvent) {
    const tasks = this.entries.filter(
      (e): e is TaskEntry => e.kind === 'task' && !e.outcome && !e.error,
    );
    // A task's first step claims the oldest intent still waiting for one.
    const entry = tasks.find((e) => e.taskId === task_id) ?? tasks.find((e) => e.taskId === null);
    if (!entry) return;
    entry.taskId = task_id;
    entry.steps.push(step);
  }
}

/**
 * Whether a task's Rewind button is worth showing. The Journal knows which
 * calls left reversible effects; for tasks older than the loaded Journal page,
 * fall back to "some step ran".
 */
export function canRewind(taskId: string, steps: StepRecord[]): boolean {
  const events = shell.journal.filter((e) => e.task_id === taskId);
  if (events.length) return events.some((e) => e.effects.some((fx) => fx.kind !== 'irreversible'));
  return steps.some((s) => s.ok && (s.verdict === 'allowed' || s.verdict === 'confirmed'));
}

/** One line for a tool's reply content. */
function describeContent(content: Json): string {
  if (content === null) return '';
  if (typeof content === 'string') return content;
  const text = JSON.stringify(content);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

export const shell = new Shell();
