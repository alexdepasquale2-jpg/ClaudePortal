/**
 * Competence = 1 - Lethality on fallback.
 * Sancient window: nearby neutrino machines go to Competence 1.
 * Nobots have no neutrino hardware. A Sancient cannot reach them.
 */

import type { Machine } from './types';

export function fallbackCompetence(lethality: number): number {
  return Math.max(0, Math.min(1, 1 - lethality));
}

export function machineCompetence(m: Machine, sancientWindow: boolean, nearSancient: boolean): number {
  if (m.kind === 'sancient') return 0.15;
  if (m.kind === 'nobot') return 0.88;
  if (sancientWindow && nearSancient && m.neutrino) return 1;
  return fallbackCompetence(m.lethality);
}

export function aimSeconds(competence: number): number {
  return 0.28 + (1 - competence) * 2.35;
}

export function hitChance(competence: number): number {
  return 0.12 + competence * 0.82;
}

export function moveSpeed(kind: Machine['kind'], competence: number): number {
  if (kind === 'sancient') return 1.35;
  if (kind === 'nobot') return 2.4;
  if (kind === 'siege') return 0.55 + competence * 1.1;
  if (kind === 'walker') return 0.85 + competence * 1.4;
  return 1.1 + competence * 1.6;
}

export function chassis(kind: Machine['kind']): { lethality: number; hp: number; neutrino: boolean } {
  switch (kind) {
    case 'sweeper':
      return { lethality: 0.18, hp: 28, neutrino: true };
    case 'occupier':
      return { lethality: 0.48, hp: 72, neutrino: true };
    case 'walker':
      return { lethality: 0.74, hp: 130, neutrino: true };
    case 'siege':
      return { lethality: 0.92, hp: 240, neutrino: true };
    case 'nobot':
      return { lethality: 0.22, hp: 46, neutrino: false };
    case 'sancient':
      return { lethality: 0.08, hp: 55, neutrino: true };
  }
}
