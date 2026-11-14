/** Was der Haushalt ohne Datenbank weiss; die Dienste (haushalt.ts) nehmen den Kontext. */
import crypto from 'node:crypto';

/** Lang genug für „später am Abend", kurz genug, dass ein liegen gebliebener
 * Code nicht dauerhaft öffnet. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const OFFENE_EINLADUNGEN_MAX = 5;

export interface Household {
  /** Eigene zuerst, dann die direkten Unterkonten. */
  memberIds: number[];
  isMain: boolean;
  /** Ein Konto kann mehreren Haushalten angehören. */
  elternIds: number[];
}

export const HAUSHALT_KANAL = 'haushalt_geaendert';
export const HAUSHALT_TTL_MS = 5 * 60 * 1000;
export const HAUSHALT_MAX = 500;

/** Ohne 0/O, 1/I/L: Der Code wird oft abgetippt. 16 Zeichen tragen rund 79 Bit. */
const CODE_ZEICHEN = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function neuerCode(): string {
  const z = Array.from({ length: 16 }, () => CODE_ZEICHEN[crypto.randomInt(CODE_ZEICHEN.length)]).join('');
  return z.match(/.{4}/g)!.join('-');
}

/** Neue Codes ohne Striche und Gross/Klein; ältere (base64url) bleiben wörtlich gültig. */
function einladungsSchluessel(code: string): string {
  const kurz = code.trim().replace(/[\s-]/g, '').toUpperCase();
  return new RegExp(`^[${CODE_ZEICHEN}]{16}$`).test(kurz) ? kurz : code.trim();
}

/** Im Klartext steht der Code nirgends. */
export function einladungsHash(token: string) {
  return crypto.createHash('sha256').update(einladungsSchluessel(token)).digest('hex');
}

// Der Kontofilter wird hier zu IDs, damit Liste und Summen dieselben Konten zählen.
export type ScopeMode = 'all' | 'own' | 'subs' | number;

/** Unbekanntes ergibt 'all'. Eine Zahl wird NICHT hier geprüft: Ob sie zum
 * Haushalt gehört, weiss erst blickfeldIds(). */
export function parseScopeMode(v: unknown): ScopeMode {
  if (v === 'own' || v === 'subs') return v;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

/** Vor `asIds()` ID oder Liste, danach `Blickfeld` (immer Liste): zwei Namen,
 * damit eine Signatur sagt, in welchem Moment sie steht. */
export type BlickfeldEingabe = number | number[];

export type Blickfeld = number[];

export function asIds(v: BlickfeldEingabe): Blickfeld {
  return Array.isArray(v) ? v.map(x => parseInt(String(x), 10)) : [parseInt(String(v), 10)];
}

/** Wer fragt und welche Konten seines Haushalts er sehen will (`accounts`). Den
 * Bereich löst der Dienst auf, nicht die Route: Jeder Aufrufer bekommt dieselbe Regel. */
export interface Sicht {
  readonly nutzer: number;
  readonly konten?: string | undefined;
}
/** Wer schreibt; sein Schreibbereich sind er selbst und seine Unterkonten. */
export interface Schreiber {
  readonly schreiber: number;
}
