// Was ein Klient von der Anwendung braucht, ohne sie zu kennen: Schlüssel,
// Kontingent, Drossel und die Brickset-Wiedervorlage. src/katalog/quellen.ts
// setzt es ein; ohne das gilt kein Schlüssel als eingetragen, und nichts geht
// hinaus.

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';
export type SchluesselName = 'rebrickable_api_key' | 'brickset_api_key'
  | 'bricklink_consumer_key' | 'bricklink_consumer_secret' | 'bricklink_token' | 'bricklink_token_secret';

export interface Drossel { waitForSlot(): Promise<void>; throttle(waitMs: number): void }

export interface KlientenZugang {
  schluessel(name: SchluesselName): Promise<string>;
  /** Zählt einen Aufruf; `allowed: false`, wenn das Tageskontingent erschöpft ist. */
  zaehle(api: ApiName): Promise<{ allowed: boolean; count: number; limit: number }>;
  kontingentStand(api: ApiName): Promise<{ count: number; limit: number; remaining: number }>;
  drossel: { vordergrund: Drossel; hintergrund: Drossel };
  /** @returns vorgemerkt: false, wenn das Set schon zu oft vorgemerkt war. */
  bricksetVormerken(setNumber: string, fehler: string, bald: boolean): Promise<{ versuch: number; vorgemerkt: boolean; hoechstens: number }>;
  bricksetVergessen(setNumber: string): Promise<void>;
}

const FREI: Drossel = { async waitForSlot() {}, throttle() {} };
const OHNE: KlientenZugang = {
  async schluessel() { return ''; },
  async zaehle() { return { allowed: true, count: 0, limit: 0 }; },
  async kontingentStand() { return { count: 0, limit: 0, remaining: 0 }; },
  drossel: { vordergrund: FREI, hintergrund: FREI },
  async bricksetVormerken() { return { versuch: 0, vorgemerkt: false, hoechstens: 0 }; },
  async bricksetVergessen() {},
};

let _zugang: KlientenZugang = OHNE;

export function verdrahteKlienten(z: KlientenZugang): void { _zugang = z; }

export function zugang(): KlientenZugang { return _zugang; }
