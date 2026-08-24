import type { MaterialCounts } from '@core/types/Vocabulary';

/**
 * Multi-piece prefabricated stamps — a turret nest, a refinery bay, a node shroud.
 *
 * A module is placed as a unit, which matters because solidifying is loud: eight pieces stamped
 * together make one large, brief noise spike rather than eight small ones spread over a minute.
 * That is a genuinely different Dread decision, not a convenience.
 *
 * Modules are session-only like everything else in the fort (ADR-0002).
 */
export interface ModuleDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Pieces and their offsets within the stamp. */
  readonly pieces: readonly {
    readonly pieceId: string;
    readonly offset: { readonly x: number; readonly y: number; readonly z: number };
    readonly rotation: number;
  }[];
  readonly totalCost: MaterialCounts;
  /** One combined spike rather than a sum of small ones. */
  readonly stampLoudness: number;
}

export class ModuleStamp {
  private readonly definitions = new Map<string, ModuleDefinition>();

  register(definition: ModuleDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  get all(): readonly ModuleDefinition[] {
    return [...this.definitions.values()];
  }

  /** Place every piece of a module as ghosts in one action. */
  stamp(
    _moduleId: string,
    _origin: { x: number; y: number; z: number },
    _rotation: number,
  ): readonly string[] {
    // TODO: implement per DESIGN.md — returns the ghost ids created.
    throw new Error('ModuleStamp.stamp not implemented');
  }
}
