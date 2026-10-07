/**
 * Render-time XUI checks. They mirror `Node::validate` in crates/types so the
 * Canvas refuses what the runtime would refuse, even if a bad tree slips through.
 */

import type { XuiNode } from './api';

export const MAX_DEPTH = 8;
export const MAX_NODES = 500;

/** The 12 node types of SPEC Appendix B. Anything else renders as "unsupported". */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'stack',
  'heading',
  'text',
  'list',
  'table',
  'card',
  'button',
  'input',
  'image',
  'chart',
  'progress',
  'rewind',
]);

const blank = (s: unknown) => typeof s !== 'string' || s.trim() === '';

/** Why this node cannot be rendered at `depth` (root = 1), or null if it can. */
export function problem(node: XuiNode, depth: number): string | null {
  if (depth > MAX_DEPTH) return `nesting is deeper than ${MAX_DEPTH} levels`;
  switch (node.type) {
    case 'button':
      return blank(node.label) ? 'button without a label' : null;
    case 'input':
      return blank(node.label) ? 'input without a label' : null;
    case 'progress':
      return blank(node.label) ? 'progress without a label' : null;
    case 'image':
      if (blank(node.alt)) return 'image without alt text';
      return blank(node.src) || node.src.includes('://')
        ? 'image source must be a local blob'
        : null;
    case 'heading': {
      const level = node.level ?? 1;
      return Number.isInteger(level) && level >= 1 && level <= 6
        ? null
        : 'heading level must be 1-6';
    }
    case 'table':
      return (node.rows ?? []).some((r) => r.length !== (node.columns ?? []).length)
        ? 'table row width differs from its columns'
        : null;
    case 'chart':
      return (node.series ?? []).some((s) => (s.values ?? []).length !== (node.x ?? []).length)
        ? 'chart series length differs from x'
        : null;
    default:
      return null;
  }
}

/** Child nodes of containers; empty for leaves. */
export function children(node: XuiNode): XuiNode[] {
  return node.type === 'stack' || node.type === 'card' ? (node.children ?? []) : [];
}

/** Total nodes in a tree, counting the root. */
export function countNodes(node: XuiNode): number {
  return children(node).reduce((n, c) => n + countNodes(c), 1);
}
