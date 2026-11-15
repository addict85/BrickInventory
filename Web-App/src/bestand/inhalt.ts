/** Was Sets, Teile und Figuren an den Bestandszeilen ändern: Die Zeilen gehören dem Bestand,
 * die Bereiche darüber rufen diese Dienste in ihrer Transaktion (über t.bestand). */
import * as gemeinsamRepo from './repository/gemeinsam';
import * as setInhaltRepo from './repository/setInhalt';
import type { BestandKontext } from './kontext';

type Zeile = { id: number; storage_id: number | null };

/** Eine manuelle Teilzeile in eine andere Farbe. Gibt es die Zielzeile schon, geht die Quelle
 * darin auf; ihren Lagerort übernimmt das Ziel nur ohne eigenen („Kiste 3“ soll bleiben). */
export async function teilzeileUmfaerben(k: BestandKontext, quelle: Zeile, ziel: Zeile | null, neueFarbe: number) {
  if (!ziel) {
    await gemeinsamRepo.faerbeTeilzeileUm(k.db, neueFarbe, quelle.id);
    return;
  }
  if (quelle.storage_id && !ziel.storage_id) await gemeinsamRepo.setzeTeilLagerort(k.db, quelle.storage_id, ziel.id);
  await gemeinsamRepo.loescheTeilzeile(k.db, quelle.id);
}

/** Die Teile oder Figuren eines Sets: was der Katalog nennt, und nur das. */
export function teileEintragen(k: BestandKontext, uid: number, sn: string, teile: string[], farben: number[]) {
  return setInhaltRepo.setTeileEintragen(k.db, uid, sn, teile, farben);
}

export function figurenEintragen(k: BestandKontext, uid: number, sn: string, nummern: string[]) {
  return setInhaltRepo.setFigurenEintragen(k.db, uid, sn, nummern);
}

export function entfernen(k: BestandKontext, uids: number[], sn: string) {
  return gemeinsamRepo.entferneSetInhalt(k.db, uids, sn);
}

export function kopieren(k: BestandKontext, tabelle: 'parts' | 'minifigs', sn: string, von: number, nach: number) {
  return gemeinsamRepo.kopiereSetInhalt(k.db, tabelle, sn, von, nach);
}

/** Ohne Menge: Sie entsteht aus der Erfassung darunter. */
export function legeTeilAn(k: BestandKontext, uid: number, teil: string, farbe: number) {
  return gemeinsamRepo.legeTeilManuellAn(k.db, uid, teil, farbe);
}

export function legeFigurAn(k: BestandKontext, uid: number, figur: string) {
  return gemeinsamRepo.legeFigurManuellAn(k.db, uid, figur);
}

export function legeAn(k: BestandKontext, art: 'part' | 'fig', uid: number, schluessel: (string | number)[]) {
  return gemeinsamRepo.legeManuellAn(k.db, art, uid, schluessel);
}

export function teileDesKontos(k: BestandKontext, uid: number) {
  return gemeinsamRepo.manuelleTeileDesKontos(k.db, uid);
}

export function figurenDesKontos(k: BestandKontext, uid: number) {
  return gemeinsamRepo.manuelleFigurenDesKontos(k.db, uid);
}
