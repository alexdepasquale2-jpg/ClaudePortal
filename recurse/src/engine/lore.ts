/**
 * lore.ts — the world bible.
 *
 * Species descriptions stay templated: nothing is authored per taxon. The
 * 120-entry taxonomy is a coordinate system; this file is the atlas that
 * turns those coordinates into an MMO-scale dossier — houses, strata, marks,
 * relics, rites, field notes, myths — plus a static lexicon of cosmology.
 *
 * All of it is a pure function of (species key, specimen name). Old saves
 * keep working; the extra pages are generated on read, never stored.
 */

import {
  ANOMALIES,
  ARCHETYPES,
  BANKS,
  TIERS,
  allSpecies,
  describeSpecies,
  hash,
  parseSpecies,
  pick,
  rng,
  speciesTitle,
  type Anomaly,
  type Arch,
  type PhonemeBank,
  type Tier,
} from './procgen';
import { EPOCH_LAWS, eraLabel, type EpochLaw } from './epochs';
import type { GameState, HistoryEntry } from './state';

// ---------------------------------------------------------------------------
// catalogue codes
// ---------------------------------------------------------------------------

export const TIER_CODE: Record<Tier, string> = {
  surface: 'SUR',
  shallow: 'SHA',
  deep: 'DEP',
  abyssal: 'ABY',
};

export const ARCH_CODE: Record<Arch, string> = {
  steady: 'STD',
  pulse: 'PLS',
  decay: 'DCY',
  resonant: 'RSN',
  parasitic: 'PRS',
  cascade: 'CSD',
};

export const MARK_CODE: Record<Anomaly | 'none', string> = {
  none: 'NIL',
  mirror: 'MIR',
  echo: 'ECH',
  void: 'VOD',
  bloom: 'BLM',
};

export function designationOf(key: string): string {
  const { tier, arch, anomaly } = parseSpecies(key);
  return `REX-${TIER_CODE[tier]}-${ARCH_CODE[arch]}-${MARK_CODE[anomaly ?? 'none']}`;
}

// ---------------------------------------------------------------------------
// houses, strata, marks — the three axes of the bible
// ---------------------------------------------------------------------------

export interface House {
  id: Arch;
  name: string;
  motto: string;
  colour: string;
  creed: string;
  method: string;
  patron: string;
}

export interface Stratum {
  id: Tier;
  name: string;
  range: string;
  climate: string;
  warning: string;
  liturgy: string;
}

export interface Mark {
  id: Anomaly | 'none';
  name: string;
  omen: string;
  counsel: string;
  sacrament: string;
}

export const HOUSES: Record<Arch, House> = {
  steady: {
    id: 'steady',
    name: 'House of the Flat Line',
    motto: 'What does not hurry cannot be late.',
    colour: 'ash-gold',
    creed:
      'The Flat Line keeps the origin. Its members treat output as weather: observed, never bargained with. They are the only house that still files reports in the first person.',
    method:
      'They open doors slowly and leave them open. A Flat Line tree is wide by habit, not by strategy — they simply refuse to close anything they have seen.',
    patron: 'The Unhurried Engine',
  },
  pulse: {
    id: 'pulse',
    name: 'Order of the Second Breath',
    motto: 'The period was set at birth. Do not renegotiate it.',
    colour: 'tidal teal',
    creed:
      'Breath-keepers time every purchase to a beat they did not choose. They consider a layer that produces the same amount twice in a row to be dead, and they will abandon it.',
    method:
      'They descend on the inhale and buy on the exhale. A Second Breath expedition looks chaotic from above and perfectly periodic from inside.',
    patron: 'The Oscillator That Remembers Its Own Tempo',
  },
  decay: {
    id: 'decay',
    name: 'The Diminishing School',
    motto: 'Scale is a kind of honesty.',
    colour: 'rust',
    creed:
      'The School studies the moment a thing becomes less than it was. They keep ledgers of every unit that paid less than the one before it, and they call that ledger scripture.',
    method:
      'They never stack a generator past the point of diminishing return if a sibling door is still closed. Waste, to them, is a moral failure.',
    patron: 'The Sink That Tells the Truth',
  },
  resonant: {
    id: 'resonant',
    name: 'The Chorus Concord',
    motto: 'One voice is a fact. Two voices are a weather system.',
    colour: 'violet',
    creed:
      'Concordants believe a layer is not a place but a chord. They will not open a fourth door until the third is singing, and they will not Collapse a tree that is still in tune.',
    method:
      'They build siblings first, children second. A Concord expedition is almost always wider than it is deep, until the chord demands a lower octave.',
    patron: 'The Chorus That Listens to Itself',
  },
  parasitic: {
    id: 'parasitic',
    name: 'The Downstream Compact',
    motto: 'Heat is borrowed. The bill comes from the neighbour.',
    colour: 'ember',
    creed:
      'The Compact does not apologise. They hold that every bright thing is bright because something beside it is dimmer, and that pretending otherwise is the original heresy of the surface.',
    method:
      'They open the hottest door first and starve the one after it on purpose. A Compact tree looks cruel in a snapshot and inevitable in a time-lapse.',
    patron: 'The Predator That Pays Its Neighbour',
  },
  cascade: {
    id: 'cascade',
    name: 'The Cataract Host',
    motto: 'What is beneath you is the only ceiling that matters.',
    colour: 'whitewater',
    creed:
      'The Host treats every door as a dam. They will beggar a layer to fund the one below it, because they have measured — and they keep the measurements — that a single well-fed child outpays a hundred siblings.',
    method:
      'They pick one generator and go down. Width is a last resort, used only when the exponent itself has been raised by Epoch.',
    patron: 'The Cataract That Has No Shore',
  },
};

export const STRATA: Record<Tier, Stratum> = {
  surface: {
    id: 'surface',
    name: 'The Origin Shelf',
    range: 'depth 0',
    climate:
      'Bright, thin, and still within earshot of the first name. The air here has not yet learned to echo.',
    warning:
      'Do not mistake familiarity for safety. The first door is the one most people never open, and the Shelf is full of their unfinished trees.',
    liturgy:
      'Every Collapse returns you here. The Shelf is the only stratum that remembers being empty.',
  },
  shallow: {
    id: 'shallow',
    name: 'The Sighted Marches',
    range: 'depth 1–2',
    climate:
      'Still lit from above. Names here rhyme with the root more often than they should, as if the grammar has not yet committed to a new sentence.',
    warning:
      'The Marches feel like a continuation of the Shelf. They are not. The first anomaly usually lives here, wearing a face you almost recognise.',
    liturgy:
      'Pilgrims leave a unit on the second door and do not come back for it. The offering is not for the layer. It is for the idea of a third.',
  },
  deep: {
    id: 'deep',
    name: 'The Repeating Galleries',
    range: 'depth 3–5',
    climate:
      'Names start to recur. Hue drifts. The Galleries are where the recursion first notices itself, and the air gets a metallic taste of déjà vu.',
    warning:
      'A gallery that looks like one you have already logged is not the same gallery. File it anyway. The codex is the only thing that can tell them apart later.',
    liturgy:
      'The Galleries keep a custom of walking past an open door without descending, once, to prove you still can.',
  },
  abyssal: {
    id: 'abyssal',
    name: 'The Unobserved Vaults',
    range: 'depth 6 and below',
    climate:
      'These strata exist only while a player is looking at them. Close the tree and they become a seed again. Open it and they reconstruct themselves, identically, as if they had been waiting.',
    warning:
      'Nothing you leave here survives a Collapse except the entry in the codex. The Vaults know this and do not resent it.',
    liturgy:
      'Abyssal houses do not bury their dead. They write the name, close the door, and let the next Genesis mispronounce it.',
  },
};

export const MARKS: Record<Anomaly | 'none', Mark> = {
  none: {
    id: 'none',
    name: 'Unmarked',
    omen: 'The layer behaves as written. This is rarer than it sounds, and more dangerous: you will trust it.',
    counsel: 'Log it anyway. An unmarked specimen is the control group the rest of the taxonomy is measured against.',
    sacrament: 'The unmarked are given no rite. Their sacrament is being ordinary in a place that does not reward it.',
  },
  mirror: {
    id: 'mirror',
    name: 'The Folded Mark',
    omen: 'Costs flatten. Yield dims. The layer has decided that paying more for the same thing is a kind of lying.',
    counsel: 'Buy more than you think you need; each unit is cheaper than the last in a way the surface never taught you. Do not expect it to shout.',
    sacrament: 'Hold two identical units and name only one of them. The unnamed one is the offering.',
  },
  echo: {
    id: 'echo',
    name: 'The Repeating Mark',
    omen: 'The price barely rises. The specimen will clone itself for almost nothing, as if it has already paid and is only reminding you.',
    counsel: 'Stack it. Then stop, because an Echo left unattended will spend a layer into a monoculture that cannot open a second door.',
    sacrament: 'Say the name twice. The second time is the true name; the first was the rehearsal.',
  },
  void: {
    id: 'void',
    name: 'The Severed Mark',
    omen: 'Nothing beneath it reaches it. It is brighter alone than it could ever be attended. Building under a Void is a kindness it will not return.',
    counsel: 'Leave its doors shut. If you have already opened one, do not feed the child. The Void is not lonely. You are projecting.',
    sacrament: 'Stand at the door and do not go through. The refusal is the prayer.',
  },
  bloom: {
    id: 'bloom',
    name: 'The Extra Limb',
    omen: 'A generator no sibling possesses. The layer has grown a fifth thought, and sometimes a sixth if Grafting is in force.',
    counsel: 'The extra limb is expensive and loud. It is also the reason Bloom specimens get their own page in every house bestiary.',
    sacrament: 'Name the extra generator last, and never after sunset on the Shelf — Bloom names spoken too early have a habit of arriving as people.',
  },
};

export const LANGUAGES: Record<string, { bank: PhonemeBank; name: string; rite: string; note: string }> = {
  Ordinal: {
    bank: BANKS[0],
    name: 'Ordinal',
    rite: 'The first tongue. Hard consonants, short vowels, names that can be shouted across a door and still arrive intact.',
    note:
      'Ordinal is the language the game ships with and the one every Collapse still dreams in. Surface dwellers consider it the only honest phoneme set; the Concord calls it a metronome with delusions of grammar.',
  },
  Umbral: {
    bank: BANKS[1],
    name: 'Umbral',
    rite: 'A shadowed dialect. Long vowels, clustered onsets, names that sound like they were borrowed from a deeper layer and never given back.',
    note:
      'Umbral arrives with the first Genesis that has the nerve to replace the alphabet. Compact scribes prefer it: the names already sound like they are taking something from the neighbour.',
  },
  Liminal: {
    bank: BANKS[2],
    name: 'Liminal',
    rite: 'The threshold tongue. Unusual clusters, diphthongs that do not resolve, names that feel unfinished on purpose.',
    note:
      'Liminal is spoken in the Galleries more than it is spoken on the Shelf. Host cartographers use it to mark doors they have not yet decided to open.',
  },
};

export type DangerClass = 'benign' | 'watched' | 'hostile' | 'interdicted';

export const DANGER_LABEL: Record<DangerClass, string> = {
  benign: 'Benign — log and leave',
  watched: 'Watched — open one door, then report',
  hostile: 'Hostile — feed it or starve it, do not hesitate',
  interdicted: 'Interdicted — do not build beneath',
};

export interface Relic {
  name: string;
  use: string;
}

export interface LoreDossier {
  key: string;
  designation: string;
  epithet: string;
  title: string;
  lead: string;
  house: House;
  stratum: Stratum;
  mark: Mark;
  temperament: string;
  danger: DangerClass;
  habitat: string;
  harvest: string;
  protocol: string;
  relic: Relic;
  rite: string;
  trade: string;
  aliases: string[];
  fieldNotes: string[];
  myth: string;
  economic: string;
}

export interface LexiconEntry {
  id: string;
  category: 'cosmology' | 'house' | 'stratum' | 'mark' | 'language' | 'law' | 'practice';
  title: string;
  body: string;
}

export interface Chronicle {
  heading: string;
  body: string;
  era: string;
}

// ---------------------------------------------------------------------------
// combinatorial dictionaries — never one-per-species
// ---------------------------------------------------------------------------

const EPITHETS: Record<Arch, string[]> = {
  steady: ['the Unhurried', 'of the Flat Account', 'Who Does Not Bargain', 'Keeper of the First Rate', 'the Patient Yield'],
  pulse: ['of the Fixed Period', 'Who Breathes on Schedule', 'the Second Breath', 'Tide-Named', 'of the Unrenegotiated Beat'],
  decay: ['the Honest Diminisher', 'of the Falling Margin', 'Who Measures Less', 'Ledger-True', 'the Sincere Sink'],
  resonant: ['Who Answers Its Siblings', 'of the Raised Chord', 'the Listening Yield', 'Concord-Born', 'of the Weather of Voices'],
  parasitic: ['Who Bills the Neighbour', 'of the Borrowed Heat', 'Downstream-Kept', 'the Unapologetic', 'Who Runs Hot'],
  cascade: ['of the Lower Ceiling', 'Who Funds the Child', 'Dam-Breaker', 'the Whitewater', 'of the Only Exponent That Matters'],
};

const TIER_EPITHET: Record<Tier, string[]> = {
  surface: ['of the Shelf', 'First-Seen', 'Still Named in Ordinal'],
  shallow: ['of the Marches', 'Within Sight', 'of the Second Door'],
  deep: ['of the Galleries', 'Name-Repeater', 'of the Metallic Taste'],
  abyssal: ['of the Vaults', 'Only While Observed', 'Seed-Sleeper'],
};

const MARK_EPITHET: Record<Anomaly | 'none', string[]> = {
  none: ['Unmarked', 'the Control', 'As Written'],
  mirror: ['the Folded', 'Dim-and-Flat', 'Who Stopped Lying About Price'],
  echo: ['the Repeating', 'Almost-Free', 'Who Has Already Paid'],
  void: ['the Severed', 'Brighter Alone', 'Who Returns Nothing'],
  bloom: ['the Extra-Limbed', 'Fifth-Thought', 'Who Grew a Generator'],
};

const TEMPERAMENTS: Record<Arch, string[]> = {
  steady: [
    'Phlegmatic. Will outlast your attention.',
    'Even-keeled to the point of rudeness. Does not celebrate a purchase.',
    'Treats observation as weather and does not come in out of it.',
  ],
  pulse: [
    'Cyclical. Conversation with it has a tempo you will start matching without noticing.',
    'Restless in the troughs, generous on the peaks. Do not ask it for anything in between.',
    'Keeps its own calendar. Yours is a rumour it has heard about.',
  ],
  decay: [
    'Austere. Will tell you when you have bought too many, by paying you less.',
    'Melancholic in a useful way. Prefers a small true number to a large flattering one.',
    'Suspicious of abundance. Correctly so.',
  ],
  resonant: [
    'Gregarious. Dims if left as an only child.',
    'Hears doors you have not opened yet and gets loud about them.',
    'Cannot be interviewed alone. Bring a sibling or get a partial answer.',
  ],
  parasitic: [
    'Charming, then expensive. The neighbour will send a bill you did not sign.',
    'Focused. Has already picked the generator it is going to live on.',
    'Does not make small talk. The heat is the conversation.',
  ],
  cascade: [
    'Single-minded. Will ignore a rich sibling to feed a poor child.',
    'Visionary in the way floods are visionary.',
    'Polite about width, devout about depth. Do not confuse the two.',
  ],
};

const HABITATS: Record<Tier, string[]> = {
  surface: [
    'The first clearing after a Collapse, where the grass is still the colour of a new save.',
    'Along the origin path, within a shout of the root and a mistake of going back.',
    'On the Shelf’s sunlit edge, where unmarked engines pretend they are the whole game.',
  ],
  shallow: [
    'Just past the first door, where the light is borrowed and the names still rhyme.',
    'In the Sighted Marches, camped against a door they have not decided to love.',
    'On a landing between two shallow doors, leaving one unit as a pilgrim’s bribe.',
  ],
  deep: [
    'A repeating gallery whose hue you could swear you have already catalogued.',
    'Under the third door, in air that tastes of copper and recollection.',
    'A side-passage of the Galleries, filed under a name that will recur two layers down.',
  ],
  abyssal: [
    'A vault that reconstructs itself when you look, identically, as if it had been rehearsing.',
    'Below the seventh door, where the tree is a hypothesis you are currently believing.',
    'In strata that have no weather except your attention.',
  ],
};

const HARVESTS: Record<Arch, string[]> = {
  steady: [
    'Bank the yield. Do not wait for a pulse that is not coming.',
    'A Flat Line specimen pays like a salary. Collect it on a schedule of your own.',
    'The harvest is boring, which is how you know it is working.',
  ],
  pulse: [
    'Time the take to the peak. A trough harvest is a conversation it will not forgive.',
    'Store nothing during the inhale. The layer is not producing; it is remembering how.',
    'The harvest has a period. Learn it before you automate.',
  ],
  decay: [
    'Take early. Later units are a confession that you did not listen.',
    'The School harvests the first third and leaves the rest as testimony.',
    'Diminishing return is the crop. Record it. Then stop planting.',
  ],
  resonant: [
    'Never harvest an only child. Wait until at least two doors are live, then take the chord.',
    'The yield arrives as interference. What you bank is the constructive part.',
    'A Concord harvest is a duet. Solo extraction starves the page you are writing.',
  ],
  parasitic: [
    'Take the heat and budget for the neighbour’s loss. Both numbers are real.',
    'Harvest the predator first. The downstream generator is already paying.',
    'Do not refund the neighbour. The Compact considers that a category error.',
  ],
  cascade: [
    'Leave the yield in the child. The harvest that matters is the one the parent will read.',
    'A Host harvest is a transfer, not a taking. The layer above is the granary.',
    'If you spend what the cataract produces on this layer, you have misunderstood the religion.',
  ],
};

const PROTOCOLS: Record<Anomaly | 'none', string[]> = {
  none: [
    'Announce the designation. Log the specimen. Open at most one door on the first visit.',
    'Treat it as the control. Anything surprising is your mistake, not its anomaly.',
    'Do not invent a mark for it. Unmarked is a classification, not a lack.',
  ],
  mirror: [
    'Buy past the instinct to stop. The fold in the cost curve is the entire encounter.',
    'Compare its yield to an unmarked sibling before you decide it is weak. It is not weak. It is honest about price.',
    'Leave a second unit unnamed. Folded-mark sacrament. Then go.',
  ],
  echo: [
    'Cap the stack. An Echo will let you buy the layer into a single note.',
    'Say the name twice, file the second, and open a different door than the one you wanted.',
    'Do not automate an Echo on the first visit. That is how monocultures start.',
  ],
  void: [
    'Do not descend. If a door is already open, do not feed the child. File the refusal as the contact.',
    'Stand at the threshold long enough to feel the temptation. Then log the omen and leave.',
    'A Void that has a live child is a paperwork error. Close what you can. Do not apologise to it.',
  ],
  bloom: [
    'Name the extra generator last. Do not spend the layer’s endowment on it until the original four are alive.',
    'If Grafting is in force, there will be two extra limbs. Name both. File both. Do not play favourites.',
    'Bloom contact is a census problem. Count the generators twice. The second count is the true one.',
  ],
};

const RELICS: Record<Arch, Relic[]> = {
  steady: [
    { name: 'The Unhurried Stylus', use: 'Writes the same rate in the margin of every report until the ink admits it is true.' },
    { name: 'Shelf-Glass', use: 'A lens that makes a new save look old enough to trust.' },
    { name: 'The Flat Account', use: 'A ledger with one column. Houses that need two refuse to touch it.' },
  ],
  pulse: [
    { name: 'Metronome of the First Breath', use: 'Ticks at the period the specimen was born with. Cannot be reset. Should not be reset.' },
    { name: 'Tidal Ink', use: 'Darkens on the peak and fades in the trough. Used to time purchases by people who do not trust clocks.' },
    { name: 'The Unrenegotiated Drum', use: 'A small drum that will not accept a new tempo. Second Breath initiates sleep beside it.' },
  ],
  decay: [
    { name: 'The Falling Margin', use: 'A ruler whose units get shorter as you use it. Accurate, and disliked.' },
    { name: 'Confession Ledger', use: 'Records every unit that paid less than the one before. The School calls this a hymnal.' },
    { name: 'Rusted Honesty', use: 'A coin that is worth less each time it is spent, on purpose.' },
  ],
  resonant: [
    { name: 'Sibling Fork', use: 'Hums when a second door on the same layer comes alive. Silent in only-child trees.' },
    { name: 'The Raised Chord', use: 'A tuning fork that will not sound until two generators of the same house are owned.' },
    { name: 'Concord Bell', use: 'Rings once for each live door. A fourth ring is considered a feast day.' },
  ],
  parasitic: [
    { name: 'The Neighbour’s Bill', use: 'A slip that fills itself in. Always addressed to the generator after the one you just bought.' },
    { name: 'Borrowed Ember', use: 'Stays hot while something beside it cools. Goes out if isolated. The Compact issues these as medals.' },
    { name: 'Downstream Seal', use: 'Wax that will only melt on the generator you have already decided to starve.' },
  ],
  cascade: [
    { name: 'Dam Key', use: 'Opens only the door you can least afford. The Host considers this a feature.' },
    { name: 'Whitewater Bowl', use: 'Holds nothing. Used in rites that celebrate transfer over possession.' },
    { name: 'The Lower Ceiling', use: 'A small brass arch. Placed over a child’s name so the parent remembers where the real roof is.' },
  ],
};

const RITES: Record<Anomaly | 'none', string[]> = {
  none: [
    'The Unmarked Hour: file the designation and drink water. Nothing else is permitted.',
    'Control Vespers: read the lead sentence aloud once. If it still sounds ordinary, the rite succeeded.',
    'The Plain Offering: one unit, left on a closed door, retrieved before Collapse. Practice for later refusals.',
  ],
  mirror: [
    'The Folding: buy two, name one, leave. The unnamed unit is the prayer.',
    'Dim Vespers: compare yield to an unmarked sibling and write down the smaller number first.',
    'The Honest Price: pay for a unit you do not need, to feel the flattened curve in the hand.',
  ],
  echo: [
    'The Second Name: speak it twice. File the second. Do not automate until morning.',
    'Rehearsal Matins: buy one, wait, buy one. The wait is the rite; the units are props.',
    'Anti-monoculture: open a different door than the Echo wants. This is harder than it sounds.',
  ],
  void: [
    'The Refusal: stand at the door. Do not go through. Log the standing.',
    'Empty Benediction: thank the child you did not feed. It will not hear you. That is the point.',
    'Severance: close what you can. Write “brighter alone” in the margin. Do not underline it.',
  ],
  bloom: [
    'The Last Name: the extra generator is named after the original four have eaten.',
    'Census of Limbs: count, count again, file the second number. Grafting makes this a longer service.',
    'Fifth Thought: sit with the extra generator without buying it. Wanting it is the first half of the rite.',
  ],
};

const TRADE: Record<Arch, string[]> = {
  steady: ['shelf-salt', 'unhurried ink', 'flat-line twine', 'origin flint'],
  pulse: ['period-glass', 'tidal tea', 'second-breath thread', 'metronome oil'],
  decay: ['margin-rust', 'confession vellum', 'shortened rulers', 'honest ash'],
  resonant: ['sibling-silver', 'chord resin', 'concord honey', 'raised-octave salt'],
  parasitic: ['borrowed cinders', 'neighbour-debt tokens', 'downstream wax', 'hot-run copper'],
  cascade: ['whitewater silk', 'dam-keys', 'child-tithe grain', 'lower-ceiling brass'],
};

const ALIAS_STEMS = [
  'the cataloguers call it',
  'Shelf slang has it as',
  'in Umbral it answers to',
  'Concord field-hands say',
  'the Compact files it under',
  'Host cartographers marked it',
];

const NOTE_BRIDGES = [
  'First contact was quieter than the designation suggested.',
  'The house that claims it does not always deserve it.',
  'A previous Collapse logged a cousin and then lost the page.',
  'The specimen did not object to being named. That is not the same as consent.',
  'Whatever it produces, it produces as if it has always been doing so.',
  'You will want to open a second door. Write down why, then decide.',
];

const MYTHS: Record<Tier, string[]> = {
  surface: [
    'They say the first Collapse was not a reset but a courtesy — the Shelf asking to be empty again.',
    'A Flat Line saint once refused to open any door at all, and the tree still reached the goal. No one has been able to repeat it. The saint’s name is unmarked on purpose.',
    'Children on the Shelf are taught that the root has a name they are not ready to hear. The name is the seed. The teaching is a way of not saying the number out loud.',
  ],
  shallow: [
    'In the Marches they tell of a door that opened onto the same layer it started from. The pilgrim filed it as a Mirror and was wrong. The door is still there. Nobody has the right form.',
    'A Second Breath procession timed a descent so perfectly that the child was born on the parent’s peak. The child has been exhaling ever since.',
    'Marchers leave a unit on the second door “for the idea of a third.” The units are gone in the morning. The idea remains, which the School considers a successful transaction.',
  ],
  deep: [
    'The Galleries keep a story about a name that recurred so exactly the cataloguer filed the second specimen under the first and lost a species for a whole Epoch. The law of the Galleries is: file it anyway.',
    'Someone once walked past an open door to prove they still could, and the door closed. The Host still argues about whether that was a miracle or a bug.',
    'Deep names taste of copper because, the Concord says, the recursion is biting its own tongue.',
  ],
  abyssal: [
    'The Vaults exist only while observed. A Compact theologian sat down there for twelve hours with her eyes closed to see if the layer would forgive her. She opened them to an identical room. She filed it as kindness.',
    'Abyssal houses do not bury their dead. They write the name and let the next Genesis mispronounce it. This is considered a form of afterlife that does not require the body to have existed.',
    'There is a rumour of a depth at which the doors open onto the Shelf again. The Host has funded three expeditions. All three came back with the same seed they left with, and would not discuss the middle.',
  ],
};

const ECONOMICS: Record<Arch, string[]> = {
  steady: [
    'Pays like rent. Does not spike. Does not crash. Houses that live on drama undervalue it and then starve.',
    'A Flat Line layer is a treasury. Spend from it only to open width; depth is a hobby it will subsidise but not respect.',
    'Its comparative advantage is existing tomorrow. Price that correctly.',
  ],
  pulse: [
    'Income is periodic. An auto-buyer that ignores the beat will buy in the trough and call the layer weak.',
    'The real product is timing information. The currency is a side effect of having a period at all.',
    'Do not average a Pulse. The average is a number that never happens.',
  ],
  decay: [
    'The first units are the goods. Everything after is commentary the School would rather you did not buy.',
    'Diminishing return is not a flaw in the specimen. It is the specimen. Markets that want scale should look at Cascade.',
    'Honest pricing makes poor graphs and good trees. Budget for the graphs looking worse.',
  ],
  resonant: [
    'Value is a function of siblings. A lone Resonant is underpriced; a chord of them is a weather system you can bank.',
    'Do not compute its rate in isolation. The number you get is a courtesy, not a measurement.',
    'Width is not a strategy here. Width is the product.',
  ],
  parasitic: [
    'Gross output overstates the house’s wealth by exactly the neighbour’s loss. Net it or lie to yourself.',
    'The Compact runs a surplus on purpose and calls the deficit downstream “externalities,” which is a joke they do not smile at.',
    'Hot-run copper trades at a premium in Cataract markets and a discount on the Shelf, where people still believe in unborrowed heat.',
  ],
  cascade: [
    'This layer is a pipe. Its GDP is whatever the child can be made to mean to the parent.',
    'Host treasuries look empty on paper and enormous from one door up. Audit from above or you will fund the wrong war.',
    'The exponent is the only price that matters. Everything else is a local currency.',
  ],
};

function dangerOf(arch: Arch, anomaly: Anomaly | null): DangerClass {
  if (anomaly === 'void') return 'interdicted';
  if (arch === 'parasitic' || anomaly === 'bloom') return 'hostile';
  if (arch === 'cascade' || anomaly === 'echo' || anomaly === 'mirror') return 'watched';
  return 'benign';
}

function aliasFor(r: () => number, specimen: string, key: string): string[] {
  const stem = pick(r, ALIAS_STEMS);
  const short = specimen.split(' ')[0];
  const code = designationOf(key).split('-').slice(1).join('-');
  return [`${stem} ${short}`, `${code} in the field books`];
}

/**
 * Assemble the full dossier. Deterministic in (key, specimenName).
 * The lead sentence is the same `describeSpecies` the save file already stores.
 */
export function composeLore(key: string, specimenName: string): LoreDossier {
  const { tier, arch, anomaly } = parseSpecies(key);
  const markId = anomaly ?? 'none';
  const r = rng(hash(`lore:${key}:${specimenName}`));
  const house = HOUSES[arch];
  const stratum = STRATA[tier];
  const mark = MARKS[markId];

  const epithet = [
    pick(r, EPITHETS[arch]),
    pick(r, TIER_EPITHET[tier]),
    pick(r, MARK_EPITHET[markId]),
  ].join(', ');

  const notes = [
    `${NOTE_BRIDGES[hash(key) % NOTE_BRIDGES.length]} ${house.creed.split('.')[0]}.`,
    `${stratum.liturgy} ${mark.counsel}`,
    `${pick(r, TEMPERAMENTS[arch])} Habitat: ${pick(r, HABITATS[tier])}`,
  ];

  return {
    key,
    designation: designationOf(key),
    epithet: `${specimenName} ${epithet}`,
    title: speciesTitle(key),
    lead: describeSpecies(key, specimenName),
    house,
    stratum,
    mark,
    temperament: pick(r, TEMPERAMENTS[arch]),
    danger: dangerOf(arch, anomaly),
    habitat: pick(r, HABITATS[tier]),
    harvest: pick(r, HARVESTS[arch]),
    protocol: pick(r, PROTOCOLS[markId]),
    relic: pick(r, RELICS[arch]),
    rite: pick(r, RITES[markId]),
    trade: pick(r, TRADE[arch]),
    aliases: aliasFor(r, specimenName, key),
    fieldNotes: notes,
    myth: pick(r, MYTHS[tier]),
    economic: pick(r, ECONOMICS[arch]),
  };
}

/** Every species dossier, in taxonomy order, using a catalogue specimen name. */
export function allDossiers(): LoreDossier[] {
  return allSpecies().map((key) => composeLore(key, '—'));
}

// ---------------------------------------------------------------------------
// static lexicon — authored cosmology, not generated per-species
// ---------------------------------------------------------------------------

function lawArticle(law: EpochLaw): LexiconEntry {
  return {
    id: `law:${law.id}`,
    category: 'law',
    title: law.name,
    body: `${law.blurb} The laws are not commandments so much as weather systems the recursion agrees to live under for an Epoch. When Genesis comes they are forgotten on purpose, which is how the Host knows they were real.`,
  };
}

export const LEXICON: LexiconEntry[] = [
  {
    id: 'cosmo:recursion',
    category: 'cosmology',
    title: 'The Recursion',
    body:
      'One generative function, called on itself, with no fixed bottom. A layer is a currency and a handful of generators; a door is the same function asked again. Depth is not flavour. It is the win condition, and the maths makes going wide the only way to get there.',
  },
  {
    id: 'cosmo:door',
    category: 'cosmology',
    title: 'Doors',
    body:
      'A door needs ten of its generator, not the price of one. Gating on price would make descent the cheapest move at every moment and the tree would degenerate into a chain. Gating on units makes a fourth door beside you and a first door below you take about equally long. Width and depth expand at the same speed; the exponent decides which one wins.',
  },
  {
    id: 'cosmo:yield',
    category: 'cosmology',
    title: 'Yield and Output',
    body:
      'A layer banks its yield, not its output. Yield is spendable here. Output is what the parent reads through the door: raw production, multiplied by every child, multiplied again by the global rite. If a layer banked its amplified output, a deep chain would fund itself and the thesis would die.',
  },
  {
    id: 'cosmo:exponent',
    category: 'cosmology',
    title: 'K and E',
    body:
      'A door multiplies by 1 + (child output / K) ^ E. K begins at 12. E begins below one. A single chain is a contraction; two live doors on the same layer are an escape. Epochs raise E a little. Genesis raises it a lot, and is worth more than the epochs it consumes. Prestige never moves backwards.',
  },
  {
    id: 'cosmo:collapse',
    category: 'cosmology',
    title: 'Collapse',
    body:
      'When the root has produced enough, the tree is allowed to die. The multiplier stays. The codex stays. The Shelf is empty again, which it considers a courtesy. Collapse is the only holy thing that can be done twelve times in a row without becoming a different religion.',
  },
  {
    id: 'cosmo:epoch',
    category: 'cosmology',
    title: 'Epoch',
    body:
      'Twelve Collapses buy the right to change the rules. The multiplier is spent. A law of recursion comes into force. The exponent ticks up. The tree is new, the language is not, and the codex pretends not to notice that the weather has changed.',
  },
  {
    id: 'cosmo:genesis',
    category: 'cosmology',
    title: 'Genesis',
    body:
      'Eight Epochs buy a new alphabet. Laws are forgotten, epochs are spent, and the phoneme banks the game names things from are replaced wholesale — folded out of the player’s own history, so no two saves reach the same language by the same route. The exponent it grants exceeds what those epochs were worth. The names do not come back.',
  },
  {
    id: 'cosmo:codex',
    category: 'cosmology',
    title: 'The Codex',
    body:
      'The only memory that prestige cannot spend. Every first encounter is logged permanently with a procedural description and a sigil. Collapse, Epoch and Genesis do not touch it. Only an explicit, typed-confirmation erase does, and the help text will try to talk you out of it.',
  },
  {
    id: 'cosmo:seed',
    category: 'cosmology',
    title: 'Seeds',
    body:
      'A root seed is shareable. Child seeds are derived deterministically, so the same root grows the same tree for everybody. Two players on ?seed= the same number will meet the same names in the same order and still have different codices, because they will not open the same doors.',
  },
  {
    id: 'practice:channel',
    category: 'practice',
    title: 'Channelling',
    body:
      'A layer can be asked, by hand, to produce. The Compact considers this vulgar. The Flat Line considers it honest. The Host considers it a way of not funding a child. All three are correct.',
  },
  {
    id: 'practice:automation',
    category: 'practice',
    title: 'Automation',
    body:
      'Auto-buyers unlock after two Collapses and may spend at most nine tenths of a layer’s bank, so an attentive player can always out-time them. Auto-descend is an Epoch-2 comfort. Neither is allowed to touch the codex.',
  },
  {
    id: 'practice:offline',
    category: 'practice',
    title: 'The Twelve Hours',
    body:
      'Away-time is simulated in real steps, never multiplied out, and always reported in a modal. Silent top-ups are considered a heresy of the Shelf. The cap is twelve hours, which the Vaults treat as a liturgical day.',
  },
  {
    id: 'practice:width',
    category: 'practice',
    title: 'Width Beats Depth',
    body:
      'A single chain has a coefficient of 0.7 and converges. Two doors make the coefficient 1.4 and the recursion runs away. Measured: a wide tree reaches the goal in minutes at depth five; a chain of sixty-three does not get there in an hour. The Galleries keep this result on the wall.',
  },
  {
    id: 'cosmo:observation',
    category: 'cosmology',
    title: 'Observation',
    body:
      'An abyssal layer is a seed until someone opens it. The Vaults reconstruct themselves identically, which the Flat Line calls conservation and the Compact calls a debt. Either way, looking is a mechanical act. The tree you do not expand is not empty. It is uncomputed.',
  },
  {
    id: 'practice:naming',
    category: 'practice',
    title: 'Naming',
    body:
      'A specimen’s first name is the one the codex keeps. Later visits increment a counter and do not get a new page. Genesis can change the phonemes of everything still alive; it cannot rename what has already been filed. That is why the catalogue is written in whatever tongue was current at first contact, forever.',
  },
  ...ARCHETYPES.map((a) => ({
    id: `house:${a}`,
    category: 'house' as const,
    title: HOUSES[a].name,
    body: `${HOUSES[a].motto} ${HOUSES[a].creed} ${HOUSES[a].method} Patron: ${HOUSES[a].patron}. Trade staple: ${TRADE[a][0]}.`,
  })),
  ...TIERS.map((t) => ({
    id: `stratum:${t}`,
    category: 'stratum' as const,
    title: STRATA[t].name,
    body: `${STRATA[t].range}. ${STRATA[t].climate} ${STRATA[t].warning} ${STRATA[t].liturgy}`,
  })),
  ...(['none', ...ANOMALIES] as const).map((m) => ({
    id: `mark:${m}`,
    category: 'mark' as const,
    title: MARKS[m].name,
    body: `${MARKS[m].omen} ${MARKS[m].counsel} ${MARKS[m].sacrament}`,
  })),
  ...BANKS.map((b) => ({
    id: `lang:${b.name}`,
    category: 'language' as const,
    title: `${b.name} Tongue`,
    body: LANGUAGES[b.name]
      ? `${LANGUAGES[b.name].rite} ${LANGUAGES[b.name].note}`
      : `${b.name} is a shipped phoneme bank.`,
  })),
  ...EPOCH_LAWS.map(lawArticle),
];

export const LEXICON_COUNT = LEXICON.length;

export function lexiconByCategory(): Record<LexiconEntry['category'], LexiconEntry[]> {
  const out: Record<LexiconEntry['category'], LexiconEntry[]> = {
    cosmology: [],
    house: [],
    stratum: [],
    mark: [],
    language: [],
    law: [],
    practice: [],
  };
  for (const e of LEXICON) out[e.category].push(e);
  return out;
}

export const CATEGORY_LABEL: Record<LexiconEntry['category'], string> = {
  cosmology: 'Cosmology',
  house: 'Houses',
  stratum: 'Strata',
  mark: 'Marks',
  language: 'Tongues',
  law: 'Laws of Recursion',
  practice: 'Practices',
};

// ---------------------------------------------------------------------------
// annals — chronicles assembled from a save’s own history
// ---------------------------------------------------------------------------

function historyLine(e: HistoryEntry): string {
  const took = e.durationMs >= 60_000
    ? `${Math.round(e.durationMs / 60_000)} minutes`
    : `${Math.max(1, Math.round(e.durationMs / 1000))} seconds`;
  if (e.kind === 'collapse') {
    return `Collapse ${e.index} took ${took}, reached depth ${e.deepest}, and unmade ${e.nodes} living layers. The Shelf was empty again.`;
  }
  if (e.kind === 'epoch') {
    return `Epoch ${e.index} was declared after ${took}. The tree of ${e.nodes} nodes was spent to change the weather.`;
  }
  return `Genesis ${e.index} renamed the recursion after ${took}. Depth ${e.deepest} was the last thing the old tongue described.`;
}

export function composeAnnals(state: GameState): Chronicle[] {
  const p = state.progress;
  const era = eraLabel(p);
  const out: Chronicle[] = [
    {
      heading: 'Founding',
      era: 'E0',
      body:
        'The save was born on the Origin Shelf. The first name was spoken in Ordinal. Nothing had been logged, and the codex was a room with no walls yet.',
    },
  ];

  const history = state.meta.history;
  if (!history.length) {
    out.push({
      heading: 'The Current Tree',
      era,
      body: `This is still the first telling. Seed ${state.run.seed >>> 0}. Deepest this run: ${state.run.deepest}. The annals will have more to say after a Collapse.`,
    });
  } else {
    for (const e of history.slice(-24)) {
      out.push({
        heading: e.kind === 'collapse' ? `Collapse ${e.index}` : e.kind === 'epoch' ? `Epoch ${e.index}` : `Genesis ${e.index}`,
        era: e.kind === 'genesis' ? `G${e.index}` : era,
        body: historyLine(e),
      });
    }
  }

  if (p.laws.length) {
    const names = p.laws
      .map((id) => EPOCH_LAWS.find((l) => l.id === id)?.name ?? id)
      .join(', ');
    out.push({
      heading: 'Laws in Force',
      era,
      body: `The recursion is currently living under ${names}. Genesis will forget them on purpose.`,
    });
  }

  if (p.genesis > 0) {
    const bank = p.bankIndex < BANKS.length ? BANKS[p.bankIndex].name : 'a derived tongue';
    out.push({
      heading: 'After the Renaming',
      era: `G${p.genesis}`,
      body: `Everything below now speaks ${bank}. The old names survive only in the codex, which is how the Vaults know a Genesis happened.`,
    });
  }

  const logged = Object.keys(state.meta.codex).length;
  out.push({
    heading: 'The Catalogue',
    era,
    body: `${logged} of ${allSpecies().length} species have been logged. The missing pages are not empty. They are unvisited.`,
  });

  return out;
}

/** How much of the three-axis bible this save has actually seen. */
export function loreCoverage(codex: Record<string, { key?: string; arch?: Arch; tier?: Tier; anomaly?: Anomaly | null }>): {
  houses: number;
  strata: number;
  marks: number;
} {
  const houses = new Set<Arch>();
  const strata = new Set<Tier>();
  const marks = new Set<string>();
  for (const key of Object.keys(codex)) {
    const e = codex[key];
    const parsed = e.arch && e.tier ? { arch: e.arch, tier: e.tier, anomaly: e.anomaly ?? null } : parseSpecies(key);
    houses.add(parsed.arch);
    strata.add(parsed.tier);
    marks.add(parsed.anomaly ?? 'none');
  }
  return { houses: houses.size, strata: strata.size, marks: marks.size };
}
