/**
 * Every discrete action the player can bind a key or gesture to.
 *
 * Lives in `core` rather than alongside the input adapters because the Settings menu has to render
 * a rebinding list, and `ui` cannot import `gameplay` (ARCHITECTURE.md). The vocabulary is shared;
 * the implementations that consume it are not.
 */
export type InputAction =
  | 'place'
  | 'solidify'
  | 'scrap'
  | 'plant-node'
  | 'light-node'
  | 'install-chrome'
  | 'arm-nobots'
  | 'toggle-build'
  | 'cycle-view'
  | 'extract'
  | 'abandon'
  | 'pause';

export const INPUT_ACTIONS = [
  'place',
  'solidify',
  'scrap',
  'plant-node',
  'light-node',
  'install-chrome',
  'arm-nobots',
  'toggle-build',
  'cycle-view',
  'extract',
  'abandon',
  'pause',
] as const satisfies readonly InputAction[];

/**
 * Actions that must remain reachable in every unlocked view. Rebinding may not strand these —
 * a run the player cannot extract from is not a configuration, it is a trap.
 */
export const ESSENTIAL_ACTIONS: readonly InputAction[] = ['extract', 'pause', 'toggle-build'];
