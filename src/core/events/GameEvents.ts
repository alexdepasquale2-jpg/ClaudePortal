import type {
  Faction,
  FlavorTag,
  MaterialTier,
  NobotGroupId,
  NodeId,
  RunEndType,
  SiteId,
  Vec3,
  ViewMode,
} from '../types/Vocabulary';

/**
 * The event vocabulary.
 *
 * This map is the contract between systems that must not know about each other. It is also, read
 * top to bottom, an honest summary of what the game is about: nodes are lit, noise accumulates,
 * Sancients arrive and jack, competence floors rise, allies radicalise and betray, and a run
 * resolves into something the campaign graph keeps.
 *
 * Payloads are plain, serialisable data — no live object references. An event outliving the thing
 * that raised it must still make sense (the Consequence pillar is largely about exactly that).
 */
export interface GameEventMap {
  // ---- run lifecycle -------------------------------------------------------
  'run/started': { readonly siteId: SiteId; readonly seed: number; readonly runIndex: number };
  /** A run is over. This is the only moment the campaign graph may be mutated by a run. */
  'run/resolved': {
    readonly siteId: SiteId;
    readonly endType: RunEndType;
    readonly durationMs: number;
  };
  'run/tick': { readonly elapsedMs: number };

  // ---- view ---------------------------------------------------------------
  'view/changed': { readonly from: ViewMode; readonly to: ViewMode };

  // ---- the deliberate, dangerous decision ---------------------------------
  'node/planted': { readonly nodeId: NodeId; readonly position: Vec3 };
  /** Lighting an NNN is never incidental and never free. This is the Dread pillar firing. */
  'node/lit': { readonly nodeId: NodeId; readonly isPrimary: boolean };
  'node/extinguished': {
    readonly nodeId: NodeId;
    readonly reason: 'player' | 'destroyed' | 'runEnd';
  };
  'node/chromeInstalled': { readonly nodeId: NodeId };
  'node/contested': { readonly nodeId: NodeId; readonly by: Faction };

  // ---- noise --------------------------------------------------------------
  'noise/emitted': { readonly position: Vec3; readonly loudness: number; readonly source: string };
  'noise/thresholdCrossed': { readonly loudness: number; readonly threshold: number };

  // ---- building (session-only; nothing here is ever persisted) -------------
  'build/ghostPlaced': { readonly pieceId: string; readonly position: Vec3 };
  /** Solidifying generates noise. That coupling is the whole cost of the Power pillar. */
  'build/solidified': { readonly pieceId: string; readonly loudness: number };
  'build/scrapped': {
    readonly pieceId: string;
    readonly refund: Readonly<Record<MaterialTier, number>>;
  };

  // ---- the reversal -------------------------------------------------------
  'sancient/arrived': { readonly sancientId: string; readonly powerTier: number };
  /** A Goliath just stopped being a clown. CompetenceWarning must make this legible. */
  'sancient/jacked': {
    readonly sancientId: string;
    readonly targetIds: readonly string[];
    readonly durationMs: number | 'permanent';
  };
  'sancient/released': { readonly sancientId: string; readonly targetIds: readonly string[] };
  'competence/floorChanged': {
    readonly position: Vec3;
    readonly radius: number;
    readonly floor: number;
  };

  // ---- factions -----------------------------------------------------------
  'nobot/armed': { readonly groupId: NobotGroupId };
  'nobot/radicalised': {
    readonly groupId: NobotGroupId;
    readonly value: number;
    readonly threshold: number;
  };
  /** They want their own protected nodes now. */
  'nobot/betrayed': { readonly groupId: NobotGroupId };

  // ---- resources ----------------------------------------------------------
  'material/collected': { readonly tier: MaterialTier; readonly amount: number };
  /** Discovery of a usable Pyron Chrome mass is a campaign-level event, not a pickup. */
  'material/pyronChromeFound': { readonly siteId: SiteId; readonly mass: number };
  'production/ticked': {
    readonly nodeId: NodeId;
    readonly tier: MaterialTier;
    readonly amount: number;
  };

  // ---- flavor -------------------------------------------------------------
  'flavor/tagChanged': { readonly from: FlavorTag | null; readonly to: FlavorTag };

  // ---- campaign consequence ----------------------------------------------
  /** The Consequence pillar, as one event. Somebody else owns it now. */
  'campaign/ownershipFlipped': {
    readonly siteId: SiteId;
    readonly from: Faction;
    readonly to: Faction;
  };
  'campaign/saved': { readonly version: number };
}

export type GameEventName = keyof GameEventMap;
export type GameEventPayload<K extends GameEventName> = GameEventMap[K];
