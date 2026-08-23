/**
 * screens.ts — every full-screen surface that is not the game board.
 *
 * Codex, discovery feed, achievements, stats, settings, save management and
 * the welcome-back summary. All of them read the engine and none of them
 * mutate it except through the callbacks passed in.
 */

import { Engine, type OfflineSummary } from '../../engine/actions';
import { GOAL } from '../../engine/economy';
import {
  ACHIEVEMENTS,
  achievementBonus,
  type Achievement,
} from '../../engine/achievements';
import {
  COLLAPSES_PER_EPOCH,
  EPOCHS_PER_GENESIS,
  EPOCH_LAWS,
  baseExponent,
  lawById,
} from '../../engine/epochs';
import {
  ARCH_LABEL,
  ARCHETYPES,
  ANOMALIES,
  SPECIES_COUNT,
  TIERS,
  allSpecies,
  parseSpecies,
  sigilParams,
  speciesTitle,
  hash,
  type Anomaly,
  type Tier,
} from '../../engine/procgen';
import {
  CATEGORY_LABEL,
  DANGER_LABEL,
  LEXICON_COUNT,
  composeAnnals,
  composeLore,
  lexiconByCategory,
  loreCoverage,
} from '../../engine/lore';
import { HISTORY_LIMIT, type CodexEntry, type SigilCache } from '../../engine/state';
import { readableAccent } from '../palette';
import { MODE_LABELS, sigilThumbnail, type SigilMode } from '../sigil';
import { dur, fmt, pct, plural, stamp } from './format';
import { confirmModal, h, openModal } from './modal';

export interface ScreenDeps {
  engine: Engine;
  sigils: SigilCache;
  onSettingsChange(): void;
  onExport(): void;
  onImport(json: string): void;
  onErase(): void;
  onReseed(seed: number): void;
  toast(msg: string): void;
}

// ---------------------------------------------------------------------------
// codex
// ---------------------------------------------------------------------------

/**
 * A hue for a species that is stable across saves — the codex tile for
 * "abyssal cascade / void" is the same colour in everybody's game.
 */
function speciesHue(key: string): number {
  return hash(key) % 360;
}

export function speciesThumb(key: string, mode: SigilMode, sigils: SigilCache): string {
  const cacheKey = `${key}|${mode}`;
  const cached = sigils[cacheKey];
  if (cached) return cached;
  const hue = speciesHue(key);
  const url = sigilThumbnail({
    mode,
    seed: sigilParams(hash(key), hue),
    hue,
    growth: 0.75,
    depth: 5,
    time: 0,
    still: true,
    fills: [0.9, 0.7, 0.5, 0.3, 0.15],
  });
  sigils[cacheKey] = url;
  return url;
}

export function openCodex(deps: ScreenDeps, tab: 'species' | 'lexicon' | 'annals' = 'species'): void {
  const { engine, sigils } = deps;
  const codex = engine.state.meta.codex;
  const mode = engine.state.meta.settings.sigilMode;
  const cover = loreCoverage(codex);

  openModal(
    'Codex',
    (body) => {
      const found = Object.keys(codex).length;
      body.appendChild(
        h(
          'p',
          { class: 'muted' },
          `${found} of ${SPECIES_COUNT} species logged (${pct(found / SPECIES_COUNT)}). ` +
            `${cover.houses}/6 houses, ${cover.strata}/4 strata, ${cover.marks}/5 marks seen. ` +
            `${LEXICON_COUNT} lexicon entries. The codex survives every Collapse, Epoch and Genesis.`,
        ),
      );

      const panes: Record<string, HTMLElement> = {
        species: h('div', { class: 'codex-pane' }),
        lexicon: h('div', { class: 'codex-pane' }),
        annals: h('div', { class: 'codex-pane' }),
      };

      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const buttons: Record<string, HTMLButtonElement> = {};
      const show = (id: 'species' | 'lexicon' | 'annals'): void => {
        for (const k of Object.keys(panes)) {
          panes[k].hidden = k !== id;
          buttons[k].classList.toggle('is-on', k === id);
          buttons[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        }
      };
      for (const [id, label] of [
        ['species', 'Species'],
        ['lexicon', 'Lexicon'],
        ['annals', 'Annals'],
      ] as const) {
        const b = h('button', {
          class: 'btn btn-sm',
          text: label,
          role: 'tab',
          'aria-selected': 'false',
        }) as HTMLButtonElement;
        b.addEventListener('click', () => show(id));
        buttons[id] = b;
        tabs.appendChild(b);
      }

      buildSpeciesPane(panes.species, codex, mode, sigils);
      buildLexiconPane(panes.lexicon);
      buildAnnalsPane(panes.annals, engine);

      body.append(tabs, panes.species, panes.lexicon, panes.annals);
      show(tab);
    },
    { wide: true },
  );
}

function buildSpeciesPane(
  host: HTMLElement,
  codex: Record<string, CodexEntry>,
  mode: SigilMode,
  sigils: SigilCache,
): void {
  const filters = h('div', { class: 'filters' });
  let tierFilter: Tier | 'all' = 'all';
  let anomFilter: Anomaly | 'none' | 'all' = 'all';
  let archFilter: string = 'all';
  let onlyFound = false;

  const grid = h('div', { class: 'codex-grid' });

  const draw = (): void => {
    grid.textContent = '';
    let shown = 0;
    for (const key of allSpecies()) {
      const p = parseSpecies(key);
      if (tierFilter !== 'all' && p.tier !== tierFilter) continue;
      if (archFilter !== 'all' && p.arch !== archFilter) continue;
      if (anomFilter !== 'all') {
        if (anomFilter === 'none' && p.anomaly !== null) continue;
        if (anomFilter !== 'none' && p.anomaly !== anomFilter) continue;
      }
      const entry = codex[key];
      if (onlyFound && !entry) continue;
      shown++;
      grid.appendChild(tile(key, entry, mode, sigils));
    }
    if (shown === 0) {
      grid.appendChild(h('p', { class: 'muted', text: 'Nothing matches those filters.' }));
    }
  };

  filters.append(
    select('Tier', ['all', ...TIERS], (v) => {
      tierFilter = v as Tier | 'all';
      draw();
    }),
    select('Archetype', ['all', ...ARCHETYPES], (v) => {
      archFilter = v;
      draw();
    }),
    select('Anomaly', ['all', 'none', ...ANOMALIES], (v) => {
      anomFilter = v as Anomaly | 'none' | 'all';
      draw();
    }),
  );
  const toggle = h('button', { class: 'btn btn-sm', text: 'Found only' });
  toggle.addEventListener('click', () => {
    onlyFound = !onlyFound;
    toggle.classList.toggle('is-on', onlyFound);
    draw();
  });
  filters.appendChild(toggle);
  host.append(filters, grid);
  draw();
}

function buildLexiconPane(host: HTMLElement): void {
  host.appendChild(
    h(
      'p',
      { class: 'muted' },
      'The world bible. Houses, strata, marks, tongues and laws — authored once, ' +
        'then crossed with the 120-species taxonomy to produce every dossier.',
    ),
  );
  const grouped = lexiconByCategory();
  for (const cat of Object.keys(grouped) as (keyof typeof grouped)[]) {
    const entries = grouped[cat];
    if (!entries.length) continue;
    const list = h('div', { class: 'lexicon' });
    for (const e of entries) {
      const item = h('details', { class: 'lex-item' });
      item.append(h('summary', { text: e.title }), h('p', { text: e.body }));
      list.appendChild(item);
    }
    host.appendChild(section(CATEGORY_LABEL[cat], [list]));
  }
}

function buildAnnalsPane(host: HTMLElement, engine: Engine): void {
  host.appendChild(
    h(
      'p',
      { class: 'muted' },
      'Chronicles assembled from this save. Prestige spends the tree; it does not spend the annals.',
    ),
  );
  const list = h('div', { class: 'annals' });
  for (const c of composeAnnals(engine.state)) {
    list.appendChild(
      h(
        'article',
        { class: 'annal' },
        h('h4', { class: 'annal-head', text: c.heading }),
        h('p', { class: 'muted small', text: c.era }),
        h('p', { text: c.body }),
      ),
    );
  }
  host.appendChild(list);
}

function tile(
  key: string,
  entry: CodexEntry | undefined,
  mode: SigilMode,
  sigils: SigilCache,
): HTMLElement {
  const p = parseSpecies(key);
  const hue = speciesHue(key);
  const el = h('button', {
    class: `codex-tile${entry ? '' : ' is-locked'}`,
    'aria-label': entry ? `${entry.name}, ${speciesTitle(key)}` : `Unknown ${speciesTitle(key)}`,
  });

  if (entry) {
    const img = h('img', { class: 'codex-sigil', alt: '', src: speciesThumb(key, mode, sigils) });
    el.append(
      img,
      h('div', { class: 'codex-name', text: entry.name, style: `color:${readableAccent(hue)}` }),
      h('div', { class: 'codex-kind muted small', text: speciesTitle(key) }),
    );
    el.addEventListener('click', () => {
      const lore = composeLore(key, entry.name);
      openModal(entry.name, (b) => {
        b.append(
          h('img', { class: 'codex-sigil-big', alt: '', src: speciesThumb(key, mode, sigils) }),
          h('p', { class: 'lede', text: lore.title }),
          h('p', { class: 'muted small', text: `${lore.designation} · ${lore.epithet}` }),
          h('p', { text: lore.lead }),
          h('p', { class: 'lore-note', text: lore.fieldNotes[0] }),
          h('p', { class: 'lore-note', text: lore.fieldNotes[1] }),
          section('Field dossier', [
            kv('House', `${lore.house.name} — “${lore.house.motto}”`),
            kv('Stratum', `${lore.stratum.name} (${lore.stratum.range})`),
            kv('Mark', lore.mark.name),
            kv('Danger', DANGER_LABEL[lore.danger]),
            kv('Temperament', lore.temperament),
            kv('Habitat', lore.habitat),
            kv('Harvest', lore.harvest),
            kv('First contact', lore.protocol),
            kv('Relic', `${lore.relic.name}. ${lore.relic.use}`),
            kv('Rite', lore.rite),
            kv('Trade staple', lore.trade),
            kv('Lodge', lore.lodge),
            kv('Chronicler', lore.chronicler),
            kv('Also known as', lore.aliases.join('; ')),
            kv('Economy', lore.economic),
          ]),
          h('p', { class: 'lore-myth', text: lore.myth }),
          section('Catalogue', [
            kv('Tier', p.tier),
            kv('Dominant archetype', ARCH_LABEL[p.arch]),
            kv('Anomaly', p.anomaly ?? 'none'),
            kv('First found', `${stamp(entry.firstSeen)} at depth ${entry.depth} (${entry.era})`),
            kv('Specimens seen', entry.seen.toLocaleString()),
          ]),
        );
      });
    });
  } else {
    el.append(
      h('div', { class: 'codex-sigil codex-unknown', text: '?' }),
      h('div', { class: 'codex-name muted', text: 'Unlogged' }),
      h('div', { class: 'codex-kind muted small', text: speciesTitle(key) }),
    );
    el.setAttribute('disabled', '');
  }
  return el;
}

export function openFeed(deps: ScreenDeps): void {
  const feed = deps.engine.state.meta.feed;
  openModal('Discoveries', (body) => {
    if (!feed.length) {
      body.appendChild(h('p', { class: 'muted', text: 'Nothing logged yet. Open a door.' }));
      return;
    }
    body.appendChild(
      h('p', { class: 'muted', text: `${plural(feed.length, 'first encounter')}, newest first.` }),
    );
    const list = h('ol', { class: 'feed' });
    for (const d of feed) {
      const hue = speciesHue(d.key);
      list.appendChild(
        h(
          'li',
          { class: 'feed-row' },
          h('span', { class: 'feed-dot', style: `background:${readableAccent(hue)}` }),
          h('span', { class: 'feed-name', text: d.name }),
          h('span', { class: 'feed-kind muted small', text: speciesTitle(d.key) }),
          h('span', { class: 'feed-when muted small', text: `${stamp(d.at)} · depth ${d.depth}` }),
        ),
      );
    }
    body.appendChild(list);
  });
}

// ---------------------------------------------------------------------------
// achievements
// ---------------------------------------------------------------------------

export function openAchievements(deps: ScreenDeps): void {
  const { engine } = deps;
  openModal(
    'Achievements',
    (body) => {
      const got = engine.state.meta.achievements;
      const count = ACHIEVEMENTS.filter((a) => got[a.id]).length;
      body.appendChild(
        h(
          'p',
          { class: 'muted' },
          `${count} of ${ACHIEVEMENTS.length} earned. Together they are worth ` +
            `+${achievementBonus(engine.state).toFixed(2)} to the global multiplier.`,
        ),
      );
      const list = h('div', { class: 'ach-grid' });
      for (const a of ACHIEVEMENTS) {
        const done = !!got[a.id];
        const hidden = a.secret && !done;
        list.appendChild(
          h(
            'div',
            { class: `ach${done ? ' is-done' : ''}` },
            h('div', { class: 'ach-name', text: hidden ? '???' : a.name }),
            h('div', {
              class: 'ach-desc muted small',
              text: hidden ? 'A secret milestone.' : a.desc,
            }),
            h('div', {
              class: 'ach-meta small',
              text: done ? `+${a.bonus.toFixed(2)} · ${stamp(got[a.id])}` : `+${a.bonus.toFixed(2)}`,
            }),
          ),
        );
      }
      body.appendChild(list);
    },
    { wide: true },
  );
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

export function openStats(deps: ScreenDeps): void {
  const { engine } = deps;
  const s = engine.state.meta.stats;
  const p = engine.state.progress;
  const n = engine.state.meta.settings.notation;

  openModal(
    'Statistics',
    (body) => {
      body.append(
        section('This run', [
          kv('Root output', `${fmt(engine.rates[''] ?? 0, n)}/s`),
          kv('Root lifetime', `${fmt(engine.root?.lifetime ?? 0, n)} of ${fmt(GOAL, n)}`),
          kv('Progress to Collapse', pct(engine.goalProgress())),
          kv('Nodes alive', engine.order.length.toLocaleString()),
          kv('Deepest this run', String(engine.state.run.deepest)),
          kv('Elapsed', dur(Date.now() - engine.state.run.startedAt)),
          kv('Seed', String(engine.state.run.seed)),
        ]),
        section('All time', [
          kv('Lifetime output, every epoch', fmt(s.lifetimeAll, n)),
          kv('Deepest depth ever', String(s.deepestDepth)),
          kv('Nodes ever created', s.nodesEverCreated.toLocaleString()),
          kv('Doors ever opened', s.doorsEverOpened.toLocaleString()),
          kv('Units ever bought', s.unitsEverBought.toLocaleString()),
          kv('Channels', s.channels.toLocaleString()),
          kv('Fastest collapse', s.fastestCollapseMs ? dur(s.fastestCollapseMs) : '—'),
          kv('Time played', dur(s.playtimeMs)),
          kv('Offline time claimed', dur(s.offlineMsClaimed)),
          kv(
            'Species logged',
            `${Object.keys(engine.state.meta.codex).length} / ${SPECIES_COUNT} · ${LEXICON_COUNT} lexicon entries`,
          ),
          kv(
            'Lore coverage',
            (() => {
              const c = loreCoverage(engine.state.meta.codex);
              return `${c.houses}/6 houses, ${c.strata}/4 strata, ${c.marks}/5 marks`;
            })(),
          ),
        ]),
        section('Prestige', [
          kv('Collapses', `${p.collapses} (${s.totalCollapses} all time)`),
          kv('Epochs', `${p.epochs} (${s.totalEpochs} all time)`),
          kv('Genesis', `${p.genesis} (${s.totalGenesis} all time)`),
          kv('Global multiplier', `×${engine.globalMult().toFixed(2)}`),
          kv('Door exponent E', baseExponent(p).toFixed(3)),
          kv('Laws held', p.laws.length ? p.laws.map((l) => lawById(l)?.name ?? l).join(', ') : 'none'),
        ]),
      );

      const history = engine.state.meta.history.slice().reverse();
      const hist = h('div', { class: 'section' }, h('h3', { text: 'History' }));
      if (!history.length) {
        hist.appendChild(h('p', { class: 'muted', text: 'No resets yet.' }));
      } else {
        const table = h('table', { class: 'table' });
        table.appendChild(
          h(
            'tr',
            {},
            h('th', { text: 'Event' }),
            h('th', { text: '#' }),
            h('th', { text: 'Took' }),
            h('th', { text: 'Depth' }),
            h('th', { text: 'Nodes' }),
            h('th', { text: 'When' }),
          ),
        );
        for (const e of history.slice(0, HISTORY_LIMIT)) {
          table.appendChild(
            h(
              'tr',
              { class: `hist-${e.kind}` },
              h('td', { text: e.kind }),
              h('td', { text: String(e.index) }),
              h('td', { text: dur(e.durationMs) }),
              h('td', { text: String(e.deepest) }),
              h('td', { text: e.nodes.toLocaleString() }),
              h('td', { text: stamp(e.at) }),
            ),
          );
        }
        hist.appendChild(table);
      }
      body.appendChild(hist);
    },
    { wide: true },
  );
}

// ---------------------------------------------------------------------------
// settings & saves
// ---------------------------------------------------------------------------

export function openSettings(deps: ScreenDeps): void {
  const { engine } = deps;
  const st = engine.state.meta.settings;

  openModal('Settings', (body, close) => {
    body.append(
      section('Display', [
        choice(
          'Sigil style',
          (Object.keys(MODE_LABELS) as SigilMode[]).map((m) => [m, MODE_LABELS[m]]),
          st.sigilMode,
          (v) => {
            st.sigilMode = v as SigilMode;
            deps.onSettingsChange();
          },
        ),
        choice(
          'Number notation',
          [
            ['scientific', 'Scientific (1.2e9)'],
            ['engineering', 'Engineering (1.2e9)'],
            ['letters', 'Letters (1.2B)'],
          ],
          st.notation,
          (v) => {
            st.notation = v as typeof st.notation;
            deps.onSettingsChange();
          },
        ),
      ]),
      section('Accessibility', [
        choice(
          'Motion',
          [
            ['auto', 'Follow system setting'],
            ['full', 'Full animation'],
            ['reduced', 'Reduced — instant state changes'],
          ],
          st.motion,
          (v) => {
            st.motion = v as typeof st.motion;
            deps.onSettingsChange();
          },
        ),
        toggleRow('Sound', st.sound, (v) => {
          st.sound = v;
          deps.onSettingsChange();
        }),
        toggleRow('Haptics', st.haptics, (v) => {
          st.haptics = v;
          deps.onSettingsChange();
        }),
      ]),
      section('Automation', [
        numberRow('Auto-buy interval (seconds)', st.autoInterval, 0.5, 30, (v) => {
          st.autoInterval = v;
          deps.onSettingsChange();
        }),
        toggleRow(
          engine.rules.autoDescend
            ? 'Auto-descend into the richest open door'
            : 'Auto-descend (unlocks at Epoch 2)',
          st.autoDescend,
          (v) => {
            st.autoDescend = v;
            deps.onSettingsChange();
          },
          !engine.rules.autoDescend,
        ),
      ]),
    );

    const saves = h('div', { class: 'section' }, h('h3', { text: 'Save data' }));
    saves.appendChild(
      h('p', {
        class: 'muted small',
        text:
          'The game saves locally on its own. Export a copy anyway — a browser clearing site ' +
          'data is the only thing that can lose a codex, and an exported blob is immune to it.',
      }),
    );

    const exportBtn = h('button', { class: 'btn', text: 'Export save' });
    exportBtn.addEventListener('click', () => deps.onExport());

    const importBtn = h('button', { class: 'btn', text: 'Import save' });
    importBtn.addEventListener('click', () => {
      close();
      openImport(deps);
    });

    const seedBtn = h('button', { class: 'btn', text: 'Share seed' });
    seedBtn.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(engine.state.run.seed));
      void navigator.clipboard?.writeText(url.toString()).then(
        () => deps.toast('Seed link copied'),
        () => deps.toast(url.toString()),
      );
    });

    const reseedBtn = h('button', { class: 'btn', text: 'New seed' });
    reseedBtn.addEventListener('click', () => {
      confirmModal(
        'Restart on a new seed?',
        'This throws away the current tree and starts a fresh one. Your codex, achievements, ' +
          'stats and prestige are untouched.',
        'New seed',
        () => {
          close();
          deps.onReseed((Math.random() * 0xffffffff) >>> 0);
        },
      );
    });

    const eraseBtn = h('button', { class: 'btn btn-danger', text: 'Erase everything' });
    eraseBtn.addEventListener('click', () => {
      confirmModal(
        'Erase everything?',
        'This deletes the tree, the prestige, the achievements and — unlike every reset in the ' +
          'game — the codex itself. There is no undo. Export a save first if you might regret it.',
        'Erase it all',
        () => {
          close();
          deps.onErase();
        },
        'ERASE',
      );
    });

    saves.appendChild(h('div', { class: 'row gap wrap' }, exportBtn, importBtn, seedBtn, reseedBtn));
    saves.appendChild(h('div', { class: 'row gap' }, eraseBtn));
    body.appendChild(saves);
  });
}

export function openExport(json: string, toast: (m: string) => void): void {
  openModal('Export save', (body) => {
    body.appendChild(
      h('p', { class: 'muted', text: 'Copy this somewhere safe. Paste it into Import to restore.' }),
    );
    const ta = h('textarea', {
      class: 'save-blob',
      readonly: true,
      spellcheck: 'false',
      'aria-label': 'Save data',
    }) as HTMLTextAreaElement;
    ta.value = json;
    body.appendChild(ta);
    const copy = h('button', { class: 'btn', text: 'Copy to clipboard' });
    copy.addEventListener('click', () => {
      ta.select();
      void navigator.clipboard?.writeText(json).then(
        () => toast('Save copied'),
        () => toast('Select the text and copy it manually'),
      );
    });
    body.appendChild(h('div', { class: 'row gap' }, copy));
    ta.focus();
    ta.select();
  });
}

export function openImport(deps: ScreenDeps): void {
  openModal('Import save', (body, close) => {
    body.appendChild(
      h('p', {
        class: 'muted',
        text: 'Paste an exported save. This replaces everything currently in the browser.',
      }),
    );
    const ta = h('textarea', {
      class: 'save-blob',
      spellcheck: 'false',
      'aria-label': 'Save data to import',
    }) as HTMLTextAreaElement;
    const err = h('p', { class: 'error small' });
    const go = h('button', { class: 'btn btn-danger', text: 'Replace my save' });
    go.addEventListener('click', () => {
      try {
        deps.onImport(ta.value);
        close();
      } catch (e) {
        err.textContent = `That did not load: ${(e as Error).message}`;
      }
    });
    body.append(ta, err, h('div', { class: 'row gap' }, go));
  });
}

// ---------------------------------------------------------------------------
// welcome back
// ---------------------------------------------------------------------------

/** Offline progress is never a silent top-up — the player is told what happened. */
export function openWelcomeBack(summary: OfflineSummary, deps: ScreenDeps): void {
  const n = deps.engine.state.meta.settings.notation;
  openModal('Welcome back', (body, close) => {
    const capped = summary.cappedMs < summary.awayMs;
    body.append(
      h('p', { class: 'lede', text: `You were away for ${dur(summary.awayMs)}.` }),
      h('p', {
        class: 'muted',
        text: capped
          ? `Offline progress is capped at forty-eight hours, so ${dur(summary.cappedMs)} was simulated.`
          : `All ${dur(summary.cappedMs)} of it was simulated.`,
      }),
      section('While you were gone', [
        kv('Root output produced', fmt(summary.rootGain, n)),
        kv('Across the whole tree', fmt(summary.totalGain, n)),
        kv('Doors opened automatically', String(summary.nodesOpened)),
        kv('New species logged', String(summary.discoveries.length)),
      ]),
    );

    if (summary.discoveries.length) {
      const list = h('ul', { class: 'plain' });
      const shown = summary.discoveries.slice(0, 80);
      for (const d of shown) {
        list.appendChild(h('li', { text: `${d.name} — ${speciesTitle(d.key)}` }));
      }
      if (summary.discoveries.length > shown.length) {
        list.appendChild(
          h('li', {
            class: 'muted',
            text: `…and ${summary.discoveries.length - shown.length} more in the Codex.`,
          }),
        );
      }
      body.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Discovered' }), list));
    }
    if (summary.achievements.length) {
      const list = h('ul', { class: 'plain' });
      for (const a of summary.achievements) list.appendChild(h('li', { text: a.name }));
      body.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Earned' }), list));
    }

    const ok = h('button', { class: 'btn btn-primary', text: 'Continue' });
    ok.addEventListener('click', close);
    body.appendChild(h('div', { class: 'row gap' }, ok));
  });
}

// ---------------------------------------------------------------------------
// prestige & help
// ---------------------------------------------------------------------------

export function openPrestige(
  deps: ScreenDeps,
  onCollapse: () => void,
  onEpoch: () => void,
  onGenesis: () => void,
): void {
  const { engine } = deps;
  const p = engine.state.progress;

  openModal('Reset', (body, close) => {
    body.appendChild(
      h('p', {
        class: 'muted',
        text:
          'Three tiers, each resetting more than the last. None of them touches the codex, the ' +
          'achievements or the statistics.',
      }),
    );

    body.appendChild(
      tierCard(
        'Collapse',
        `Root output reaches ${fmt(GOAL, engine.state.meta.settings.notation)}.`,
        `Wipes the tree. Grants +0.5 to the permanent global multiplier, which is currently ×${engine
          .globalMult()
          .toFixed(2)}.`,
        engine.goalProgress(),
        `${pct(engine.goalProgress())} of the way there`,
        engine.canCollapse(),
        'Collapse',
        () => {
          close();
          onCollapse();
        },
      ),
    );

    const nextLawId = EPOCH_LAWS.find((l) => !p.laws.includes(l.id));
    body.appendChild(
      tierCard(
        'Epoch',
        `${COLLAPSES_PER_EPOCH} Collapses.`,
        `Resets your Collapses and the multiplier they bought. Permanently raises the door ` +
          `exponent E (now ${baseExponent(p).toFixed(3)}) and grants a new law of recursion.` +
          (nextLawId ? ` Next: ${nextLawId.name} — ${nextLawId.blurb}` : ''),
        p.collapses / COLLAPSES_PER_EPOCH,
        `${p.collapses} / ${COLLAPSES_PER_EPOCH} Collapses`,
        engine.canEpoch(),
        'Begin a new Epoch',
        () => {
          close();
          onEpoch();
        },
      ),
    );

    body.appendChild(
      tierCard(
        'Genesis',
        `${EPOCHS_PER_GENESIS} Epochs.`,
        'Resets the Epochs and every law with them. Raises E by more than those Epochs were ' +
          'worth, and replaces the phoneme banks the game names things from — an entirely new ' +
          'space of names, derived from your own history.',
        p.epochs / EPOCHS_PER_GENESIS,
        `${p.epochs} / ${EPOCHS_PER_GENESIS} Epochs`,
        engine.canGenesis(),
        'Genesis',
        () => {
          close();
          onGenesis();
        },
      ),
    );

    if (p.laws.length) {
      const list = h('ul', { class: 'plain' });
      for (const id of p.laws) {
        const law = lawById(id);
        if (law) list.appendChild(h('li', {}, h('strong', { text: law.name }), ` — ${law.blurb}`));
      }
      body.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Laws in force' }), list));
    }
  });
}

function tierCard(
  name: string,
  gate: string,
  detail: string,
  progress: number,
  progressLabel: string,
  ready: boolean,
  action: string,
  onGo: () => void,
): HTMLElement {
  const btn = h('button', {
    class: `btn ${ready ? 'btn-primary' : ''}`,
    text: action,
  }) as HTMLButtonElement;
  btn.disabled = !ready;
  btn.addEventListener('click', onGo);
  return h(
    'div',
    { class: `tier-card${ready ? ' is-ready' : ''}` },
    h('h3', { text: name }),
    h('p', { class: 'small muted', text: gate }),
    h('p', { text: detail }),
    h(
      'div',
      { class: 'bar' },
      h('i', { style: `width:${(Math.min(1, progress) * 100).toFixed(1)}%` }),
    ),
    h('p', { class: 'small muted', text: progressLabel }),
    btn,
  );
}

export function openHelp(): void {
  openModal('How RECURSE works', (body) => {
    body.append(
      h('p', { class: 'lede', text: 'One function, called on itself, with no fixed bottom.' }),
      h('p', {
        text:
          'A layer is a currency and a handful of generators. Buy generators; they produce. Buy ' +
          `${'ten'} of one and its door opens: step through and you are in a brand new layer, ` +
          'generated fresh — new name, new colour, new behaviour — running the same rules.',
      }),
      section('The two numbers', [
        kv('Yield', 'What a layer banks. You spend this here, and only here.'),
        kv(
          'Output',
          'Yield multiplied by every door beneath it. This is what the layer above sees, and ' +
            'what the root accumulates toward Collapse.',
        ),
      ]),
      h('p', {
        text:
          'A door beneath you multiplies your output by 1 + (their output / 12) ^ E, with E below ' +
          '1. That exponent is the whole game. One door compounding on one door compounding on ' +
          'one door converges — a single deep chain saturates and stops paying. Two or more doors ' +
          'on the same layer multiply that term together, and the recursion runs away. Going wide ' +
          'is what makes going deep worth anything.',
      }),
      section('Things worth knowing', [
        kv('Cascade generators', 'Their door uses a harder exponent. Build under them.'),
        kv('Parasitic generators', 'Run hot, but drain the generator after them.'),
        kv('Void layers', 'Take nothing from below and burn brighter alone. Do not build under one.'),
        kv('Bloom layers', 'Come with a generator no sibling has.'),
        kv('The codex', 'Survives every reset. Species, lexicon and annals. The only progress that always keeps.'),
        kv('Houses', 'Six orders claim the six archetypes. Their mottos are in the Lexicon tab.'),
        kv('Strata', 'Origin Shelf, Sighted Marches, Repeating Galleries, Unobserved Vaults.'),
        kv('Marks', 'Unmarked, Folded, Repeating, Severed, Extra Limb — the five anomaly states.'),
        kv('Tongues', 'Six shipped alphabets, then derived banks. Genesis replaces the names, not the catalogue.'),
        kv('Laws', 'Sixteen laws of recursion, one per Epoch, held until Genesis spends them.'),
      ]),
      h('p', {
        class: 'muted small',
        text:
          'Keys: arrows move the tree, Enter focuses, 1-5 buy, Shift+1-5 open a door, C channels, ' +
          'M buys max on the best generator.',
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// small builders
// ---------------------------------------------------------------------------

function section(title: string, rows: HTMLElement[]): HTMLElement {
  return h('div', { class: 'section' }, h('h3', { text: title }), ...rows);
}

function kv(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'kv' },
    h('span', { class: 'kv-k muted', text: label }),
    h('span', { class: 'kv-v', text: value }),
  );
}

function select(label: string, options: string[], onChange: (v: string) => void): HTMLElement {
  const sel = h('select', { class: 'select', 'aria-label': label }) as HTMLSelectElement;
  for (const o of options) sel.appendChild(h('option', { value: o, text: o }));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'field' }, h('span', { class: 'muted small', text: label }), sel);
}

function choice(
  label: string,
  options: [string, string][],
  current: string,
  onChange: (v: string) => void,
): HTMLElement {
  const sel = h('select', { class: 'select', 'aria-label': label }) as HTMLSelectElement;
  for (const [v, t] of options) {
    const opt = h('option', { value: v, text: t }) as HTMLOptionElement;
    if (v === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'field' }, h('span', { class: 'muted small', text: label }), sel);
}

function toggleRow(
  label: string,
  current: boolean,
  onChange: (v: boolean) => void,
  disabled = false,
): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = current;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'field field-row' }, input, h('span', { text: label }));
}

function numberRow(
  label: string,
  current: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): HTMLElement {
  const input = h('input', {
    type: 'number',
    class: 'text-input',
    min: String(min),
    max: String(max),
    step: '0.5',
    'aria-label': label,
  }) as HTMLInputElement;
  input.value = String(current);
  input.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(input.value) || current));
    input.value = String(v);
    onChange(v);
  });
  return h('label', { class: 'field' }, h('span', { class: 'muted small', text: label }), input);
}

export type { Achievement };
