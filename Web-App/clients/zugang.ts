// Was ein Klient von der Anwendung braucht, ohne sie zu kennen: Schlüssel,
// Kontingent, Drossel und die Brickset-Wiedervorlage. Jeder Klient bekommt es
// bei seiner Erzeugung (src/fremdquellen); einen Zugang des Prozesses gibt es nicht.

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';
export type KeyName =
  | 'rebrickable_api_key'
  | 'brickset_api_key'
  | 'bricklink_consumer_key'
  | 'bricklink_consumer_secret'
  | 'bricklink_token'
  | 'bricklink_token_secret';

export interface Throttle {
  waitForSlot(): Promise<void>;
  throttle(waitMs: number): void;
}

export interface ClientsAccess {
  schluessel(name: KeyName): Promise<string>;
  /** Zählt einen Aufruf; `allowed: false`, wenn das Tageskontingent erschöpft ist. */
  zaehle(api: ApiName): Promise<{ allowed: boolean; count: number; limit: number }>;
  quotaStatus(api: ApiName): Promise<{ count: number; limit: number; remaining: number }>;
  drossel: { foreground: Throttle; hintergrund: Throttle };
  /** @returns vorgemerkt: false, wenn das Set schon zu oft vorgemerkt war. */
  bricksetReserve(
    setNumber: string,
    fehler: string,
    bald: boolean,
  ): Promise<{ versuch: number; vorgemerkt: boolean; hoechstens: number }>;
  bricksetForgotten(setNumber: string): Promise<void>;
}
