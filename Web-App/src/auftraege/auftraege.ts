import type { z } from 'zod';

/** Je Art das zod-Schema der Nutzlast. Jeder Bereich ergänzt seine Arten per `declare module`
 * (auftragsarten.ts des Bereichs): Das Einstellen ist geprüft, ohne dass dieser Bereich sie kennt. */
// biome-ignore lint/suspicious/noEmptyInterface: die Bereiche ergänzen es
export interface JobPayloads {}
export type JobKind = keyof JobPayloads & string;
export type PayloadSchema<A extends JobKind> = JobPayloads[A] extends z.ZodType ? JobPayloads[A] : never;
export type Nutzlast<A extends JobKind> = z.output<PayloadSchema<A>>;
export type PayloadInput<A extends JobKind> = z.input<PayloadSchema<A>>;

export type JobStatus = 'offen' | 'laeuft' | 'erledigt' | 'fehler' | 'abgebrochen';

export interface Fortschritt {
  erledigt?: number;
  gesamt?: number;
  text?: string | null;
  [k: string]: unknown;
}

/** Was ein Dienst vom laufenden Auftrag braucht: Stand melden, am Signal aufhören. */
export interface JobRun {
  readonly signal?: AbortSignal;
  fortschritt?(f: Fortschritt): Promise<boolean>;
}

/** Wirft den Grund des Abbruchs; zwischen zwei Schritten eines langen Laufs. */
export function checkAbort(lauf: JobRun | undefined): void {
  lauf?.signal?.throwIfAborted();
}

export interface JobRow {
  id: string;
  type: JobKind;
  payload: Record<string, unknown>;
  user_id: number | null;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  error_message: string | null;
}

export interface Einstellen {
  userId?: number | null;
  /** Steht ein offener Auftrag mit diesem Schlüssel schon da, kommt kein zweiter dazu. */
  schluessel?: string;
  maxAttempts?: number;
  afterSeconds?: number;
  /** Geht afterSeconds vor. */
  dueAb?: Date;
  fortschritt?: Fortschritt;
}

export type Belegung = Pick<JobRow, 'id' | 'locked_by'>;

/** Drosselt eine Gegenseite, wartet die ganze Art, nicht ein Auftrag. */

export interface Pause {
  type: string;
  until_at: Date;
  reason: string | null;
  level: number;
}

/** Was ein Bearbeiter vom Worker bekommt; die Fachdienste kennen nur dies, nicht den Worker. */
export interface JobContext {
  /** false: Der Auftrag gehört nicht mehr diesem Lauf (abgebrochen, neu vergeben). */
  lebenszeichen(): Promise<boolean>;
  fortschritt(f: Fortschritt): Promise<boolean>;
  /** Abgebrochen, neu vergeben oder der Prozess endet: Abrufe und Schleifen hören auf. */
  readonly signal: AbortSignal;
  /** Ein langer Auftrag hört an der nächsten sicheren Stelle auf. */
  readonly beendet: boolean;
  readonly versuch: number;
}

/** Wird zurückgegeben und später fortgesetzt, ohne als gescheitert zu gelten. */
export class JobInterrupted extends Error {
  constructor() {
    super('Auftrag unterbrochen');
  }
}

export class JobLost extends Error {
  constructor() {
    super('Auftrag gehört nicht mehr diesem Lauf');
  }
}

/** Die Gegenseite drosselt oder ein Kontingent ist erschöpft. `zaehlt`
 * entscheidet, ob es als Versuch gilt (und damit irgendwann endet). */
export class JobMove extends Error {
  constructor(
    readonly bis: Date,
    readonly grund: string,
    readonly zaehlt = false,
  ) {
    super(grund);
  }
}
