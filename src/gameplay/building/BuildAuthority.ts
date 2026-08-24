import type { MaterialCounts, Vec3 } from '@core/types/Vocabulary';

/**
 * Host authority over fort mutation.
 *
 * DESIGN.md: "Host-only place/solidify/scrap." NETWORKING.md explains why this is an interface even
 * though the game ships single-player: there is no `am I the host?` branch anywhere in the codebase.
 * Code either holds a BuildAuthority or it cannot build. Adding a networked implementation later is
 * one class, not a refactor.
 *
 * Every mutation that can spend a stockpile or change who holds ground goes through here.
 */
export interface BuildRequest {
  readonly pieceId: string;
  readonly position: Vec3;
  readonly rotation: number;
}

export type BuildVerdict =
  | { readonly granted: true }
  | {
      readonly granted: false;
      readonly reason: 'unaffordable' | 'unsupported' | 'occupied' | 'not-host';
    };

export interface BuildAuthority {
  requestPlace(request: BuildRequest, available: MaterialCounts): BuildVerdict;
  requestSolidify(pieceId: string): BuildVerdict;
  requestScrap(pieceId: string): BuildVerdict;
}

/** The only implementation today: this client is the host and answers immediately. */
export class LocalHostAuthority implements BuildAuthority {
  requestPlace(_request: BuildRequest, _available: MaterialCounts): BuildVerdict {
    // TODO: implement per DESIGN.md — affordability, support, and occupancy checks.
    throw new Error('LocalHostAuthority.requestPlace not implemented');
  }

  requestSolidify(_pieceId: string): BuildVerdict {
    // TODO: implement per DESIGN.md
    throw new Error('LocalHostAuthority.requestSolidify not implemented');
  }

  requestScrap(_pieceId: string): BuildVerdict {
    // TODO: implement per DESIGN.md
    throw new Error('LocalHostAuthority.requestScrap not implemented');
  }
}
