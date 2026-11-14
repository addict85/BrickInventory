/** Der Worker kennt für jede Art einen Bearbeiter. */
export const AUFTRAGS_ARTEN = [
  'nacharbeit',
  'bilder',
  'pdf',
  'csv_import',
  'wechselkurse',
  'anleitung',
  'brickset',
  'bildbedarf',
  'bilder_neu_laden',
  'nachlauf',
  'csv_sync',
  'preise',
  'bild_nachlauf',
  'aufraeumen',
  'aufraeumen_taeglich',
  'preise_nachladen',
  'konto_dateien',
  'widerrufsliste',
] as const;
export type AuftragsArt = (typeof AUFTRAGS_ARTEN)[number];

/** Nur diese Arten laufen ohne Konto im Systemrahmen, am Zeilenschutz vorbei; der Grund
 * steht hier. Ein Auftrag mit Konto läuft immer in dessen Namen, die übrigen Arten ohne
 * Konto arbeiten am Katalog und sehen keine Kontozeile (imNamenDesAuftrags). */
export const KONTOUEBERGREIFEND: Readonly<Partial<Record<AuftragsArt, string>>> = {
  nachlauf: 'Altbestand und Katalog aller Konten',
  csv_sync: 'BrickLink-Nummern der Teile aller Konten',
  preise: 'Preise aller Sets',
  bild_nachlauf: 'Bilder aller Bestände',
  bildbedarf: 'Bildbedarf aller Bestände',
  bilder_neu_laden: 'fehlende Bilder aller Bestände',
  aufraeumen: 'Reste aller Konten',
  aufraeumen_taeglich: 'Reste aller Konten',
};

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
