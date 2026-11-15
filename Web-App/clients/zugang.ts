// Was ein Klient von der Anwendung braucht, ohne sie zu kennen: Schlüssel,
// Kontingent, Drossel und die Brickset-Wiedervorlage. Jeder Klient bekommt es
// bei seiner Erzeugung (src/fremdquellen); einen Zugang des Prozesses gibt es nicht.

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
