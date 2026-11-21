// What a client needs from the application without knowing it: keys,
// quota, throttle and the Brickset resubmission. Every client receives it
// when it is created (src/externalSources); there is no process-wide access.

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
  /** Counts a call; `allowed: false` once the daily quota is used up. */
  zaehle(api: ApiName): Promise<{ allowed: boolean; count: number; limit: number }>;
  quotaStatus(api: ApiName): Promise<{ count: number; limit: number; remaining: number }>;
  drossel: { foreground: Throttle; hintergrund: Throttle };
  /** @returns vorgemerkt: false if the set was already queued too often. */
  bricksetReserve(
    setNumber: string,
    fehler: string,
    bald: boolean,
  ): Promise<{ versuch: number; vorgemerkt: boolean; hoechstens: number }>;
  bricksetForgotten(setNumber: string): Promise<void>;
}
