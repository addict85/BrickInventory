// Was ein Klient von der Anwendung braucht, ohne sie zu kennen: Schlüssel,
// Kontingent, Drossel und die Brickset-Wiedervorlage. startup/verdrahtung.ts
// setzt es beim Start ein; fehlt das, wirft jeder Abruf, statt still ohne
// Schlüssel und ohne Kontingent zu laufen.

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';
export type SchluesselName =
  | 'rebrickable_api_key'
  | 'brickset_api_key'
  | 'bricklink_consumer_key'
  | 'bricklink_consumer_secret'
  | 'bricklink_token'
  | 'bricklink_token_secret';

export interface Drossel {
  waitForSlot(): Promise<void>;
  throttle(waitMs: number): void;
}

export interface KlientenZugang {
  schluessel(name: SchluesselName): Promise<string>;
  /** Zählt einen Aufruf; `allowed: false`, wenn das Tageskontingent erschöpft ist. */
  zaehle(api: ApiName): Promise<{ allowed: boolean; count: number; limit: number }>;
  kontingentStand(api: ApiName): Promise<{ count: number; limit: number; remaining: number }>;
  drossel: { vordergrund: Drossel; hintergrund: Drossel };
  /** @returns vorgemerkt: false, wenn das Set schon zu oft vorgemerkt war. */
  bricksetVormerken(
    setNumber: string,
    fehler: string,
    bald: boolean,
  ): Promise<{ versuch: number; vorgemerkt: boolean; hoechstens: number }>;
  bricksetVergessen(setNumber: string): Promise<void>;
}

let _zugang: KlientenZugang | null = null;

export function verdrahteKlienten(z: KlientenZugang): void {
  _zugang = z;
}

export function zugang(): KlientenZugang {
  if (!_zugang) throw new Error('Klienten nicht verdrahtet: startup/verdrahtung.ts verdrahte() fehlt beim Start');
  return _zugang;
}
