import type { Renderer } from '../render/scene';
import type { CommandQueue } from '../net/queue';
import type { World } from '../sim/types';
import type { Command } from '../net/protocol';

export type Ctx = {
  world: World;
  queue: CommandQueue;
  renderer: Renderer;
  send: (c: Command) => void;
  root: HTMLElement;
  openPanel: (name: string, data?: unknown) => void;
  closePanel: (name: string) => void;
  isOpen: (name: string) => boolean;
};
