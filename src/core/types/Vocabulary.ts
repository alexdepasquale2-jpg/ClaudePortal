/**
 * The design's vocabulary, as closed unions.
 *
 * These are unions rather than enums on purpose: they serialise as themselves (so a save file is
 * readable), and they are exhaustively checkable (so a switch that forgets a case fails typecheck).
 *
 * That second property is load-bearing for FlavorTag. DESIGN.md: "HUD reads player verbs and applies
 * exactly one locked mechanical consequence per tag. Labels without consequences are forbidden."
 * Adding a sixth tag here breaks TagConsequenceApplicator's exhaustive switch — which is exactly the
 * intended outcome.
 */

/** The five flavor tags. Each MUST have exactly one locked mechanical consequence. */
export type FlavorTag = 'Militant' | 'Logistics' | 'Diplomatic' | 'Subversive' | 'Expedition';

export const FLAVOR_TAGS = [
  'Militant',
  'Logistics',
  'Diplomatic',
  'Subversive',
  'Expedition',
] as const satisfies readonly FlavorTag[];

/**
 * One pawn, three live-switchable views. Top-down is the default (steep, auto-fire Survivors spine).
 * Camera and building are coupled — see ViewSwitcher. Views reach parity late via meta unlocks.
 */
export type ViewMode = 'TopDown' | 'ThirdPerson' | 'FirstPerson';

export const VIEW_MODES = [
  'TopDown',
  'ThirdPerson',
  'FirstPerson',
] as const satisfies readonly ViewMode[];

export const DEFAULT_VIEW_MODE: ViewMode = 'TopDown';

/**
 * Who can hold a site. 'Nobot' here means a post-betrayal Nobot group: before betrayal they are
 * allies and hold nothing of their own (ADR-0004).
 */
export type Faction = 'Neet' | 'Goliath' | 'Sancient' | 'Nobot' | 'Unowned';

export const FACTIONS = [
  'Neet',
  'Goliath',
  'Sancient',
  'Nobot',
  'Unowned',
] as const satisfies readonly Faction[];

/**
 * The four material tiers. PyronChrome is found, never forged — its only mechanical purpose is to
 * protect a primary NNN (reduced noise signature, extended safe hold time). Discovery of a usable
 * mass is a campaign-level event.
 */
export type MaterialTier = 'Scrap' | 'Rack' | 'Plate' | 'PyronChrome';

export const MATERIAL_TIERS = [
  'Scrap',
  'Rack',
  'Plate',
  'PyronChrome',
] as const satisfies readonly MaterialTier[];

/**
 * How a run ended. DESIGN.md: "Feats on different tracks per end type" — this union is what splits
 * the tracks, so it is not merely descriptive.
 */
export type RunEndType = 'Extracted' | 'Died' | 'Abandoned';

export const RUN_END_TYPES = [
  'Extracted',
  'Died',
  'Abandoned',
] as const satisfies readonly RunEndType[];

/** Stable identifiers used across the campaign graph and save format. */
export type SiteId = string & { readonly __brand: 'SiteId' };
export type RegionId = string & { readonly __brand: 'RegionId' };
export type NodeId = string & { readonly __brand: 'NodeId' };
export type NobotGroupId = string & { readonly __brand: 'NobotGroupId' };
export type BlueprintId = string & { readonly __brand: 'BlueprintId' };

export const siteId = (raw: string): SiteId => raw as SiteId;
export const regionId = (raw: string): RegionId => raw as RegionId;
export const nodeId = (raw: string): NodeId => raw as NodeId;
export const nobotGroupId = (raw: string): NobotGroupId => raw as NobotGroupId;
export const blueprintId = (raw: string): BlueprintId => raw as BlueprintId;

/** A quantity of each material tier. Used for stockpiles, backpacks, and build costs alike. */
export type MaterialCounts = Readonly<Record<MaterialTier, number>>;

export const emptyMaterialCounts = (): MaterialCounts => ({
  Scrap: 0,
  Rack: 0,
  Plate: 0,
  PyronChrome: 0,
});

/** A point in a live site. Campaign-level positions use Vec2 on the region map instead. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Exhaustiveness helper. Call it in the default branch of a switch over a closed union; if a new
 * member is added and not handled, this fails to compile.
 */
export function assertNever(value: never, message = 'Unhandled union member'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
