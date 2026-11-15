import type { z } from 'zod';

/** Je Art das zod-Schema der Nutzlast. Jeder Bereich ergänzt seine Arten per `declare module`
 * (auftragsarten.ts des Bereichs): Das Einstellen ist geprüft, ohne dass dieser Bereich sie kennt. */
// biome-ignore lint/suspicious/noEmptyInterface: die Bereiche ergänzen es
export interface AuftragsNutzlasten {}
export type AuftragsArt = keyof AuftragsNutzlasten & string;
export type NutzlastSchema<A extends AuftragsArt> = AuftragsNutzlasten[A] extends z.ZodType
  ? AuftragsNutzlasten[A]
  : never;
export type Nutzlast<A extends AuftragsArt> = z.output<NutzlastSchema<A>>;
export type NutzlastEingabe<A extends AuftragsArt> = z.input<NutzlastSchema<A>>;

export type AuftragsStatus = 'offen' | 'laeuft' | 'erledigt' | 'fehler' | 'abgebrochen';

export interface Fortschritt {
  erledigt?: number;
  gesamt?: number;
  text?: string | null;
  [k: string]: unknown;
}

/** Was ein Dienst vom laufenden Auftrag braucht: Stand melden, am Signal aufhören. */
export interface AuftragsLauf {
  readonly signal?: AbortSignal;
  fortschritt?(f: Fortschritt): Promise<boolean>;
}

/** Wirft den Grund des Abbruchs; zwischen zwei Schritten eines langen Laufs. */
export function pruefeAbbruch(lauf: AuftragsLauf | undefined): void {
  lauf?.signal?.throwIfAborted();
}

export interface AuftragsZeile {
  id: string;
  art: AuftragsArt;
  nutzlast: Record<string, unknown>;
  user_id: number | null;
  schluessel: string | null;
  status: AuftragsStatus;
  versuche: number;
  max_versuche: number;
  belegt_von: string | null;
  fehler: string | null;
}

export interface Einstellen {
  userId?: number | null;
  /** Steht ein offener Auftrag mit diesem Schlüssel schon da, kommt kein zweiter dazu. */
  schluessel?: string;
  maxVersuche?: number;
  nachSekunden?: number;
  /** Geht nachSekunden vor. */
  faelligAb?: Date;
  fortschritt?: Fortschritt;
}

export type Belegung = Pick<AuftragsZeile, 'id' | 'belegt_von'>;

// Drosselt eine Gegenseite oder will sie Abstand, wartet die ganze Art, nicht
// ein Auftrag.

export interface Pause {
  art: string;
  bis: Date;
  grund: string | null;
  stufe: number;
}

/** Was ein Bearbeiter vom Worker bekommt; die Fachdienste kennen nur dies, nicht den Worker. */
export interface AuftragsKontext {
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
export class AuftragUnterbrochen extends Error {
  constructor() {
    super('Auftrag unterbrochen');
  }
}

export class AuftragVerloren extends Error {
  constructor() {
    super('Auftrag gehört nicht mehr diesem Lauf');
  }
}

/** Die Gegenseite drosselt oder ein Kontingent ist erschöpft. `zaehlt`
 * entscheidet, ob es als Versuch gilt (und damit irgendwann endet). */
export class AuftragVerschieben extends Error {
  constructor(
    readonly bis: Date,
    readonly grund: string,
    readonly zaehlt = false,
  ) {
    super(grund);
  }
}
