import type { Command } from './protocol';

export interface CommandQueue {
  push(cmd: Command): void;
  drain(): Command[];
}

export class LocalQueue implements CommandQueue {
  private q: Command[] = [];
  push(cmd: Command) { this.q.push(cmd); }
  drain(): Command[] { const out = this.q; this.q = []; return out; }
}
