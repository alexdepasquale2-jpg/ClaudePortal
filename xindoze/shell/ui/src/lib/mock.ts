/**
 * An in-browser stand-in for the Xindoze runtime, used when the Canvas runs
 * outside Tauri (`npm run dev`). It plays a few scripted intents end to end:
 * a chart, a table, an act + Rewind, and commit actions that raise an
 * `xz://ask` and wait for the user's answer.
 *
 * Only type imports here, so Node's test runner can load this file directly.
 */

import type {
  AskEvent,
  AskInfo,
  CharterView,
  Command,
  Effect,
  EgressEvent,
  GenomeInfo,
  JournalEvent,
  Json,
  Outcome,
  Pulse,
  RewindReport,
  Risk,
  StepEvent,
  StepRecord,
  ToolReply,
  Transport,
  Verdict,
  XuiNode,
} from './api';

export interface MockOptions {
  /** Simulated latency per step, in ms. */
  delayMs?: number;
}

/** Creates a fresh mock runtime. */
export function createMock(opts: MockOptions = {}): Transport {
  return new Mock(opts.delayMs ?? 300).transport();
}

// Same names as EVENT_ASK / EVENT_STEP in api.ts (kept literal: type-only imports).
const ASK = 'xz://ask';
const STEP = 'xz://step';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

const GENOMES: GenomeInfo[] = [
  [
    'xindoze.prime',
    'The system mind. Routes intents, answers system questions and rewinds actions.',
    'none',
  ],
  [
    'xindoze.files',
    'Finds files by name, type or content, organizes them and suggests what to clean up.',
    'none',
  ],
  ['xindoze.hydrate', 'Track daily water intake and show a weekly trend.', 'canvas'],
  ['xindoze.notes', 'Captures notes as Markdown files and recalls them by meaning.', 'none'],
  [
    'xindoze.web',
    'Fetches and reads web pages and summarizes them. Untrusted by design.',
    'canvas',
  ],
  [
    'xindoze.forge',
    'Makes new apps: describe one and Forge writes it as a Genome with evals.',
    'canvas',
  ],
  ['xindoze.charter', 'Settings in plain language, applied only after you confirm.', 'none'],
  ['xindoze.pulse', 'System health: models, speed, memory, Hive peers and egress.', 'none'],
].map(([id, purpose, ui]) => ({ id, version: '0.1.0', purpose, ui: ui as GenomeInfo['ui'] }));

const CHARTER: CharterView = {
  rules: [
    { id: 'c1', text: 'Never send anything without asking me.', decision: 'ask' },
    { id: 'c2', text: 'Forge may only write inside ~/Xindoze/Apps.', decision: 'allow' },
    { id: 'c3', text: 'Nothing may permanently delete files in ~/Documents.', decision: 'deny' },
    { id: 'c4', text: 'Web pages may be read from any https site.', decision: 'allow' },
  ],
};

const LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">' +
      '<defs><linearGradient id="g" x1="236" y1="176" x2="788" y2="848" gradientUnits="userSpaceOnUse">' +
      '<stop offset=".12" stop-color="#FF5A1F"/><stop offset=".5" stop-color="#F4B23A"/>' +
      '<stop offset=".88" stop-color="#2BF5C4"/></linearGradient></defs>' +
      '<rect width="1024" height="1024" rx="224" fill="#0B0D10"/>' +
      '<g fill="none" stroke="url(#g)" stroke-width="128" stroke-linecap="round">' +
      '<path d="M236 176C552 330 552 694 236 848"/><path d="M788 176C472 330 472 694 788 848"/></g></svg>',
  );

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === 'string' ? v : '');

interface StepOpts {
  risk: Risk;
  summary: string;
  verdict?: Verdict;
  ok?: boolean;
  effects?: Effect[];
  sources?: string[];
}

class Mock {
  private readonly delay: number;
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly asks = new Map<string, (approve: boolean) => void>();
  private readonly events: JournalEvent[] = [];
  private readonly egress: EgressEvent[] = [];
  private tasks = 0;
  private requests = 0;
  /** Glasses of water per day; the last entry is today. */
  private readonly week = [6, 7, 5, 4, 8, 9, 3];

  constructor(delay: number) {
    this.delay = delay;
  }

  transport(): Transport {
    return {
      invoke: <T>(cmd: Command, args?: Record<string, unknown>) =>
        this.invoke(cmd, args ?? {}) as Promise<T>,
      listen: async <T>(event: string, handler: (payload: T) => void) => {
        const set = this.listeners.get(event) ?? new Set();
        const h = handler as (payload: unknown) => void;
        set.add(h);
        this.listeners.set(event, set);
        return () => void set.delete(h);
      },
    };
  }

  private emit(event: string, payload: AskEvent | StepEvent) {
    this.listeners.get(event)?.forEach((h) => h(payload));
  }

  private async invoke(cmd: Command, a: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case 'intent':
        return this.run(null, str(a.text));
      case 'intent_for':
        return this.run(str(a.organism), str(a.text));
      case 'tool_call':
        return this.toolCall(str(a.organism), str(a.tool), (a.args ?? {}) as Json);
      case 'confirm_reply': {
        const resolve = this.asks.get(str(a.id));
        if (!resolve) throw 'not found: no pending question with that id';
        this.asks.delete(str(a.id));
        resolve(a.approve === true);
        return null;
      }
      case 'rewind':
        return this.rewind(str(a.taskId));
      case 'pulse':
        return this.pulse();
      case 'genomes':
        return GENOMES;
      case 'journal':
        return this.events.slice(-Math.max(0, Number(a.limit) || 0)).reverse();
      case 'charter':
        return CHARTER;
      case 'blob':
        return LOGO;
      case 'open_url':
        globalThis.open?.(str(a.url), '_blank', 'noopener,noreferrer');
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Intents

  private async run(target: string | null, text: string): Promise<Outcome> {
    this.requests++;
    const task = `task-${++this.tasks}`;
    const t = text.toLowerCase();
    await sleep(this.delay);
    if (target === 'xindoze.hydrate' || /water|hydrat|drink|glass|chart|week/.test(t)) {
      if (/remind/.test(t)) return this.remind(task);
      return /\b(had|drank|log|add)\b/.test(t)
        ? this.logWater(task, amount(t))
        : this.waterView(task);
    }
    if (/\b(send|post|publish|share|upload|email)\b/.test(t)) return this.post(task);
    if (/\b(delete|erase|wipe|shred|purge)\b/.test(t)) return this.purge(task);
    if (target === 'xindoze.files' || /largest|biggest|big files|space|disk/.test(t)) {
      return this.largest(task);
    }
    if (/folder|move|tidy|organi[sz]e|taxes|invoice/.test(t)) return this.tidy(task);
    if (target === 'xindoze.pulse' || /status|health|pulse|models?\b|device/.test(t)) {
      return this.status(task);
    }
    return this.help(task, target);
  }

  private async step(task: string, organism: string, tool: string, args: Json, o: StepOpts) {
    const verdict = o.verdict ?? 'allowed';
    const ok = o.ok ?? true;
    const record: StepRecord = { tool, args, verdict, ok, summary: o.summary };
    this.events.push({
      seq: this.events.length + 1,
      device: 'demo',
      ts_ms: Date.now(),
      organism,
      task_id: task,
      tool,
      args,
      risk: o.risk,
      verdict,
      taint: o.sources ? { sources: o.sources } : {},
      ok,
      summary: o.summary,
      effects: o.effects ?? [],
      rewound: false,
    });
    await sleep(this.delay);
    this.emit(STEP, { task_id: task, step: record });
    return record;
  }

  /** Raises an `xz://ask` and resolves with the user's answer. */
  private ask(task: string, ask: AskInfo): Promise<boolean> {
    const id = `ask-${task}`;
    return new Promise((resolve) => {
      this.asks.set(id, resolve);
      this.emit(ASK, { id, ask });
    });
  }

  private outcome(
    task: string,
    organism: string,
    steps: StepRecord[],
    say: string,
    ui: XuiNode | null = null,
  ): Outcome {
    return { task_id: task, organism, say, ui, steps, crystal: null, done: true };
  }

  private async waterView(task: string): Promise<Outcome> {
    const org = 'xindoze.hydrate';
    const steps = [
      await this.step(
        task,
        org,
        'engram.kv_read',
        { key: 'hydrate/week' },
        { risk: 'observe', summary: '7 days of entries' },
      ),
    ];
    const total = this.week.reduce((a, b) => a + b, 0);
    const best = DAYS[this.week.indexOf(Math.max(...this.week))];
    const today = this.week[6];
    const ui: XuiNode = {
      type: 'stack',
      children: [
        { type: 'heading', text: 'This week', level: 1 },
        { type: 'text', text: `**${total} glasses** so far. Your best day was *${best}*.` },
        {
          type: 'chart',
          kind: 'bar',
          x: DAYS,
          series: [{ name: 'Glasses', values: [...this.week] }],
          y: 'glasses',
        },
        { type: 'progress', value: today, max: 8, label: "Today's goal (glasses)" },
        {
          type: 'stack',
          direction: 'row',
          children: [
            {
              type: 'button',
              label: '+1 glass',
              action: { tool: 'hydrate.log', args: { glasses: 1 } },
            },
            {
              type: 'button',
              label: 'Remind me',
              action: { intent: 'remind me to drink water every 2 hours' },
            },
          ],
        },
        {
          type: 'card',
          title: 'Log several',
          children: [
            { type: 'input', label: 'Glasses', kind: 'number', bind: 'glasses' },
            { type: 'input', label: 'Day', kind: 'date', bind: 'day' },
            { type: 'button', label: 'Log', action: { tool: 'hydrate.log', args: {} } },
          ],
        },
      ],
    };
    return this.outcome(
      task,
      org,
      steps,
      `${total} glasses this week. ${best} was your best day.`,
      ui,
    );
  }

  private async logWater(task: string, n: number): Promise<Outcome> {
    const org = 'xindoze.hydrate';
    const pre = this.week[6];
    this.week[6] += n;
    const steps = [
      await this.step(
        task,
        org,
        'engram.kv_write',
        { key: 'hydrate/today', value: this.week[6] },
        {
          risk: 'act',
          summary: `today: ${pre} → ${this.week[6]}`,
          effects: [{ kind: 'kv_set', ns: 'xindoze.hydrate', key: 'hydrate/today', pre }],
        },
      ),
    ];
    return this.outcome(task, org, steps, `Logged ${n}. That's ${this.week[6]} today.`);
  }

  private async remind(task: string): Promise<Outcome> {
    const org = 'xindoze.hydrate';
    const steps = [
      await this.step(
        task,
        org,
        'notify.schedule',
        { title: 'Water', body: 'Time for a glass of water.', in_minutes: 120 },
        {
          risk: 'act',
          summary: 'Reminder set for 2 hours from now',
        },
      ),
    ];
    return this.outcome(task, org, steps, "I'll remind you in 2 hours.");
  }

  private async post(task: string): Promise<Outcome> {
    const org = 'xindoze.web';
    const host = 'forum.example.org';
    const sources = [`web:${host}`, 'file:~/Notes/weekly-sync.md'];
    const steps = [
      await this.step(
        task,
        org,
        'net.fetch',
        { url: `https://${host}/t/42` },
        {
          risk: 'observe',
          summary: '“Weekly sync” thread, 3.1 KB',
          sources: [`web:${host}`],
        },
      ),
    ];
    const args = {
      url: `https://${host}/t/42/reply`,
      body: 'Summary of this week: shipped the Canvas, Rewind covers moves, two open bugs.',
      content_type: 'text/markdown',
    };
    const yes = await this.ask(task, {
      organism: org,
      tool: 'net.post',
      args,
      risk: 'commit',
      reason:
        'net.post sends data off this device and cannot be rewound. Its body includes text read from the web.',
      taint: { sources },
    });
    if (yes) this.egress.push({ host, ts_ms: Date.now(), allowed: true });
    steps.push(
      await this.step(task, org, 'net.post', args, {
        risk: 'commit',
        verdict: yes ? 'confirmed' : 'declined',
        ok: yes,
        summary: yes ? `Posted 412 bytes to ${host}` : 'Declined by you',
        sources,
        effects: yes ? [{ kind: 'irreversible', note: `posted to ${host}` }] : [],
      }),
    );
    return this.outcome(
      task,
      org,
      steps,
      yes ? `Posted your summary to ${host}.` : 'Okay. Nothing was sent.',
    );
  }

  private async purge(task: string): Promise<Outcome> {
    const org = 'xindoze.files';
    const steps = [
      await this.step(
        task,
        org,
        'fs.search',
        { root: '~/Downloads', sort: 'modified', limit: 50 },
        {
          risk: 'observe',
          summary: '14 files older than 90 days, 2.3 GB',
        },
      ),
    ];
    const args = { path: '~/Downloads/old-installers' };
    const yes = await this.ask(task, {
      organism: org,
      tool: 'fs.delete_permanent',
      args,
      risk: 'commit',
      reason: "Permanent deletion can't be rewound. Moving to Trash (fs.trash) can.",
      taint: {},
    });
    steps.push(
      await this.step(task, org, 'fs.delete_permanent', args, {
        risk: 'commit',
        verdict: yes ? 'confirmed' : 'declined',
        ok: yes,
        summary: yes ? 'Deleted 14 files (2.3 GB)' : 'Declined by you',
        effects: yes ? [{ kind: 'irreversible', note: 'deleted ~/Downloads/old-installers' }] : [],
      }),
    );
    return this.outcome(
      task,
      org,
      steps,
      yes
        ? 'Deleted 14 old files and freed 2.3 GB.'
        : 'Nothing was deleted. Say *move them to Trash* to keep a way back.',
    );
  }

  private async largest(task: string): Promise<Outcome> {
    const org = 'xindoze.files';
    const steps = [
      await this.step(
        task,
        org,
        'fs.search',
        { root: '~', sort: 'size', limit: 6 },
        {
          risk: 'observe',
          summary: '6 files, 41.2 GB',
        },
      ),
    ];
    const ui: XuiNode = {
      type: 'stack',
      children: [
        { type: 'heading', text: 'Largest files', level: 1 },
        {
          type: 'table',
          columns: ['File', 'Size', 'Modified'],
          rows: [
            ['~/Videos/trip-2025.mov', '18.4 GB', '2025-08-14'],
            ['~/xindoze/models/qwen3-14b.gguf', '9.0 GB', '2026-09-30'],
            ['~/Downloads/ubuntu-24.04.iso', '6.1 GB', '2026-02-02'],
            ['~/Downloads/game-setup.exe', '4.2 GB', '2025-11-21'],
            ['~/Music/library.zip', '2.3 GB', '2024-12-01'],
            ['~/Documents/scans.pdf', '1.2 GB', '2026-03-09'],
          ],
        },
        {
          type: 'text',
          text: '*Safe to delete?* The two installers in `~/Downloads` are. Ask me to **move them to Trash** and you can rewind it.',
        },
      ],
    };
    return this.outcome(task, org, steps, 'Your 6 largest files take **41.2 GB**.', ui);
  }

  private async tidy(task: string): Promise<Outcome> {
    const org = 'xindoze.files';
    const dir = '~/Documents/Taxes 2026';
    const files = ['invoice-0412.pdf', 'invoice-0519.pdf', 'hosting-invoice.pdf'];
    const steps = [
      await this.step(
        task,
        org,
        'fs.mkdir',
        { path: dir },
        {
          risk: 'act',
          summary: `Created ${dir}`,
          effects: [{ kind: 'dir_created', path: dir }],
        },
      ),
      await this.step(
        task,
        org,
        'fs.search',
        { root: '~', name_glob: '*.pdf', contains: 'invoice' },
        {
          risk: 'observe',
          summary: `${files.length} PDFs mention “invoice”`,
        },
      ),
    ];
    for (const f of files) {
      const from = `~/Downloads/${f}`;
      steps.push(
        await this.step(
          task,
          org,
          'fs.move',
          { from, to: dir },
          {
            risk: 'act',
            summary: `Moved ${f}`,
            effects: [{ kind: 'file_moved', from, to: `${dir}/${f}` }],
          },
        ),
      );
    }
    const ui: XuiNode = {
      type: 'card',
      title: 'Taxes 2026',
      children: [
        { type: 'list', items: files.map((f) => `\`${f}\``) },
        { type: 'rewind', task_id: task },
      ],
    };
    return this.outcome(
      task,
      org,
      steps,
      `Moved ${files.length} invoices into **Taxes 2026**.`,
      ui,
    );
  }

  private async status(task: string): Promise<Outcome> {
    const org = 'xindoze.prime';
    const steps = [
      await this.step(
        task,
        org,
        'sys.info',
        {},
        { risk: 'observe', summary: 'linux x86_64, 8 CPUs, 16 GB' },
      ),
    ];
    const ui: XuiNode = {
      type: 'card',
      title: 'This device',
      children: [
        { type: 'progress', value: 9.8, max: 16, label: 'Memory in use (GB)' },
        { type: 'progress', value: 2, max: 8, label: 'Context used (thousand tokens)' },
        {
          type: 'chart',
          kind: 'line',
          x: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
          series: [
            { name: 'Cortex', values: [31, 36, 34, 40, 38, 41] },
            { name: 'Reflex', values: [88, 92, 85, 95, 90, 97] },
          ],
          y: 'tokens per second',
        },
        {
          type: 'list',
          items: [
            '**Reflex** qwen3-0.6b, loaded',
            '**Cortex** qwen3-14b, loaded',
            '**Embed** nomic-embed-text, idle',
          ],
        },
      ],
    };
    return this.outcome(
      task,
      org,
      steps,
      'All systems local. Nothing has left this device unless Pulse says so.',
      ui,
    );
  }

  private async help(task: string, target: string | null): Promise<Outcome> {
    const org = target ?? 'xindoze.prime';
    const tries = [
      'show my water this week',
      'find my largest files',
      'make a folder Taxes 2026 and move every invoice into it',
      'post my notes summary to the forum',
      'delete my old downloads',
    ];
    const ui: XuiNode = {
      type: 'card',
      title: 'Try one of these',
      children: [
        { type: 'image', src: 'xindoze-logo', alt: 'The Xindoze mark: an X drawn as a chromosome' },
        ...tries.map((intent): XuiNode => ({ type: 'button', label: intent, action: { intent } })),
      ],
    };
    return this.outcome(
      task,
      org,
      [],
      'This is the **demo runtime**: no models are attached, so I play a few scripted intents. ' +
        'Built with [Tauri](https://tauri.app) and [Svelte](https://svelte.dev).',
      ui,
    );
  }

  // -------------------------------------------------------------------------
  // Tools, Rewind, Pulse

  private async toolCall(organism: string, tool: string, args: Json): Promise<ToolReply> {
    if (tool !== 'hydrate.log') throw `unknown tool: ${tool}`;
    const raw = args && typeof args === 'object' && !Array.isArray(args) ? args.glasses : null;
    const n = Number(raw ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > 20)
      throw 'invalid arguments: glasses must be a whole number from 1 to 20';
    const task = `task-${++this.tasks}`;
    const pre = this.week[6];
    this.week[6] += n;
    await this.step(task, organism, tool, args, {
      risk: 'act',
      summary: `today: ${pre} → ${this.week[6]}`,
      effects: [{ kind: 'kv_set', ns: organism, key: 'hydrate/today', pre }],
    });
    return { content: `Logged ${n}. ${this.week[6]} today.` };
  }

  private rewind(task: string): RewindReport {
    const report: RewindReport = { undone: [], skipped: [], failed: [] };
    for (const e of [...this.events].reverse()) {
      if (e.task_id !== task || e.rewound) continue;
      for (const fx of [...e.effects].reverse()) {
        if (fx.kind === 'irreversible') {
          report.skipped.push(`Can't undo: ${fx.note}`);
          continue;
        }
        if (fx.kind === 'kv_set' && typeof fx.pre === 'number') this.week[6] = fx.pre;
        report.undone.push(describe(fx));
      }
      e.rewound = e.effects.some((fx) => fx.kind !== 'irreversible');
    }
    return report;
  }

  private pulse(): Pulse {
    return {
      host: 'demo',
      tier: 'sprout',
      models: [
        { role: 'reflex', model: 'qwen3-0.6b', backend: 'llama.cpp', loaded: true },
        { role: 'cortex', model: 'qwen3-14b', backend: 'ollama', loaded: true },
        { role: 'embed', model: 'nomic-embed-text', backend: 'llama.cpp', loaded: false },
      ],
      tokens_per_sec: 38 + Math.round(Math.random() * 60) / 10,
      requests: this.requests,
      peers: [
        { name: 'pixel-8', online: true },
        { name: 'studio-pc', online: false },
      ],
      egress: this.egress.slice(-10),
      journal_count: this.events.length,
    };
  }
}

/** Glasses mentioned in an intent ("had two glasses" -> 2), defaulting to 1. */
function amount(t: string): number {
  const digits = /\b(\d{1,2})\b/.exec(t);
  if (digits) return Math.max(1, Number(digits[1]));
  const word = NUMBERS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  return word > 0 ? word : 1;
}

function describe(fx: Exclude<Effect, { kind: 'irreversible' }>): string {
  switch (fx.kind) {
    case 'file_moved':
      return `Moved ${fx.to} back to ${fx.from}`;
    case 'dir_created':
      return `Removed the empty folder ${fx.path}`;
    case 'file_created':
      return `Removed ${fx.path}`;
    case 'file_modified':
      return `Restored the earlier version of ${fx.path}`;
    case 'file_trashed':
      return `Restored ${fx.path} from Trash`;
    case 'kv_set':
      return `Restored ${fx.key}`;
  }
}
