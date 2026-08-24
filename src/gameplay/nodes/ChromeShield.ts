import type { NeetNetNode } from './NeetNetNode';

/**
 * Pyron Chrome on a primary node.
 *
 * DESIGN.md: "Powerful magnetic plasma metal alloy. Its only mechanical purpose is to protect a
 * primary NNN (reduces noise signature and extends safe hold time). You find it; you never forge
 * it."
 *
 * ONLY mechanical purpose. Chrome is not armour, not a damage bonus, not a production multiplier.
 * Two effects, both about buying time on the Dread decision:
 *
 *   1. the node's noise signature is multiplied down
 *   2. safe hold time — how long you can run lit before a Sancient becomes eligible — is extended
 *
 * Anything else anyone wants chrome to do belongs to a different material.
 */
export interface ChromeProtection {
  /** Multiplier applied to the node's base loudness, 0..1. From the material definition. */
  readonly noiseSignatureMultiplier: number;
  /** Extra seconds before the node's loudness counts toward summoning. */
  readonly safeHoldExtension: number;
}

export class ChromeShield {
  constructor(private readonly protection: ChromeProtection) {}

  /** Only a primary node can be protected. A non-primary is refused, not silently ignored. */
  canProtect(node: NeetNetNode): boolean {
    return node.primary && !node.chromed;
  }

  /** The node's loudness with this shield applied. */
  shieldedLoudness(node: NeetNetNode): number {
    if (!node.lit) return 0;
    return node.baseLoudness * this.protection.noiseSignatureMultiplier;
  }

  /** How long this node can run lit before contributing to Sancient summoning. */
  safeHoldSeconds(_baseSafeHold: number): number {
    // TODO: implement per DESIGN.md — base plus safeHoldExtension. The extension is the second half
    // of chrome's purpose and is easy to forget; ChromeProtectionTests covers it for that reason.
    throw new Error('ChromeShield.safeHoldSeconds not implemented');
  }

  get settings(): ChromeProtection {
    return this.protection;
  }
}
