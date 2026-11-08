/** Aufgelöste Posten der Wanted-Liste als Berichtszeile und über die Anleger
 * in den Bestand schreiben. */
import { logAndContinue } from '../infra/fehler';
import type { WantedArt } from './wantedParser';
import type { Aufloesung, Sicherheit } from './wantedAufloesung';

/** Bild und Name reisen mit, weil die Vorschau sie wie die Teileliste zeigt.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#postenergebnis */
export interface PostenErgebnis {
  blId: string;
  art: WantedArt;
  blFarbe: number | null;
  menge: number;
  zustand: string | null;
  /** Je Stück; steht im Bericht, weil die Vorschau ihn änderbar zeigt. */
  maxPreis: number | null;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
  /** Kennung statt Satz, damit die Oberfläche in der Sprache des Betrachters setzt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#postenergebnis-2 */
  grundCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Beschreibung aus dem Katalog — leer, wenn er die Nummer nicht kennt. */
  name?: string | null;
  bild?: string | null;
  /** Name und Bild unter der BL-Nummer gefunden, nicht über eine Abbildung — die
   * Oberfläche muss das kennzeichnen. */
  nameGeraten?: boolean;
  farbName?: string | null;
  farbHex?: string | null;
}

/** Als Schnittstelle: Die Route steckt die echten Funktionen hinein, ein Test Zähler.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#anleger */
export interface Anleger {
  teil: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  figur: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (
    uid: number,
    setNummer: string,
    menge: number,
    zustand: string | null,
    kaufpreis: number | null,
  ) => Promise<unknown>;
}

export interface SchreibOptionen {
  anleger?: Anleger;
  /** Hereingegeben, damit diese Funktion bis auf den Anleger schreibfrei bleibt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#importierewantedliste */
  merkeNummer?: (art: WantedArt, rbId: string, blId: string, quelle: 'korrigiert' | 'rebrickable') => Promise<unknown>;
}

/** Die Berichtszeile eines Postens, vor dem Schreiben. */
export function berichtsZeile(a: Aufloesung): PostenErgebnis {
  // Eine nicht abbildbare Farbe wird nicht erfunden: color_id 0 ist bei
  // Rebrickable Schwarz, nicht „keine Farbe".
  // Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#importierewantedliste-grund
  const grund =
    a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
  const grundCode: PostenErgebnis['grundCode'] =
    a.rbId === null ? 'nummer_unbekannt' : a.farbeOffen ? 'farbe_unbekannt' : undefined;
  return {
    blId: a.posten.blId,
    art: a.posten.art,
    blFarbe: a.posten.blFarbe,
    menge: a.posten.menge,
    zustand: a.posten.zustand ?? null,
    maxPreis: a.posten.maxPreis ?? null,
    rbId: a.rbId,
    rbFarbe: a.rbFarbe,
    sicherheit: a.sicherheit,
    ausgang: a.rbId === null ? 'offen' : 'angelegt',
    ...(grund ? { grund } : {}),
    ...(grundCode ? { grundCode } : {}),
    farbName: a.rbFarbName,
    farbHex: a.rbFarbHex,
  };
}

/** Legt einen aufgelösten Posten an. @returns ob er neu ist oder aufgestockt wurde */
export async function schreibePosten(
  uid: number,
  a: Aufloesung,
  rbId: string,
  opt: SchreibOptionen,
): Promise<'angelegt' | 'aufgestockt'> {
  if (!opt.anleger) throw new Error('Kein Anleger übergeben — siehe Anleger');
  let rueckmeldung: unknown;
  if (a.posten.art === 'part') {
    // Der Farbname reist mit: Die Teileliste liest ihn von der Zeile, ohne ihn
    // fällt sie nicht auf den Katalog zurück.
    rueckmeldung = await opt.anleger.teil(uid, {
      part_number: rbId,
      color_id: a.rbFarbe ?? 0,
      ...(a.rbFarbName ? { color_name: a.rbFarbName } : {}),
      ...(a.rbFarbHex ? { color_hex: a.rbFarbHex } : {}),
      quantity: a.posten.menge,
      condition: a.posten.zustand ?? undefined,
      // `undefined` statt `null`: Die Anleger unterscheiden „nichts angegeben"
      // (Marktpreis) von einer ausdrücklichen Null.
      ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
    });
  } else if (a.posten.art === 'fig') {
    rueckmeldung = await opt.anleger.figur(uid, {
      fig_number: rbId,
      quantity: a.posten.menge,
      condition: a.posten.zustand ?? undefined,
      ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
    });
  } else {
    rueckmeldung = await opt.anleger.set(uid, rbId, a.posten.menge, a.posten.zustand, a.posten.maxPreis);
  }
  // Auch 'rebrickable' wird gemerkt: blTeilZuRb prüft jeden Treffer gegen die
  // gesuchte BL-Nummer, es ist eine Abbildung, keine Vermutung.
  // Ausführlich: docs/begruendungen/src/merkliste/wantedSchreiber.ts.md#importierewantedliste-4
  if ((a.sicherheit === 'korrigiert' || a.sicherheit === 'rebrickable') && opt.merkeNummer) {
    // Ein Fehlschlag bricht den Import nicht ab: Der Posten steht schon im Bestand.
    await opt
      .merkeNummer(a.posten.art, rbId, a.posten.blId, a.sicherheit)
      .catch(logAndContinue('wanted:nummer-merken'));
  }
  // Der Anleger weiss, ob angelegt oder aufgestockt; ohne die Frage zählte ein
  // zweiter Import alles als angelegt.
  return (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated' ? 'angelegt' : 'aufgestockt';
}
