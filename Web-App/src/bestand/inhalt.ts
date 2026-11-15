/** Was Sets, Teile und Figuren an den Bestandszeilen ändern: Die Zeilen gehören dem Bestand,
 * die Bereiche darüber rufen diese Dienste in ihrer Transaktion (über t.bestand). */
import * as gemeinsamRepo from './repository/gemeinsam';
import * as kaeufe from './repository/kaeufe';
import * as setInhaltRepo from './repository/setInhalt';
import type { BestandKontext } from './kontext';

type Zeile = { id: number; storage_id: number | null };

/** Erst Käufe addieren, dann umziehen (sonst Tagesindex). Gibt es die Zielzeile, geht die Quelle darin
 * auf; ihren Lagerort übernimmt das Ziel nur ohne eigenen („Kiste 3“ soll bleiben). */
export async function teilzeileUmfaerben(
  k: BestandKontext,
  uid: number,
  teil: string,
  quelle: Zeile & { farbe: number },
  ziel: Zeile | null,
  neueFarbe: number,
) {
  const vereint = await kaeufe.stockeGleicheErfassungenAuf(k.db, uid, teil, quelle.farbe, neueFarbe);
  await kaeufe.loescheAufgestockteErfassungen(k.db, uid, teil, quelle.farbe, neueFarbe);
  const verschoben = await kaeufe.faerbeErfassungenUm(k.db, uid, teil, quelle.farbe, neueFarbe);
  if (!ziel) await gemeinsamRepo.faerbeTeilzeileUm(k.db, neueFarbe, quelle.id);
  else {
    if (quelle.storage_id && !ziel.storage_id) await gemeinsamRepo.setzeTeilLagerort(k.db, quelle.storage_id, ziel.id);
    await gemeinsamRepo.loescheTeilzeile(k.db, quelle.id);
  }
  return { vereint: vereint.changes ?? 0, verschoben: verschoben.changes ?? 0 };
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

/** Nur, wenn das Ziel noch keinen Inhalt hat: Sonst zählte die Zusammenfassung ihn doppelt. */
export function kopieren(k: BestandKontext, tabelle: 'parts' | 'minifigs', sn: string, von: number, nach: number) {
  return gemeinsamRepo.kopiereSetInhalt(k.db, tabelle, sn, von, nach);
}

/** Ohne Menge: Sie entsteht aus der Erfassung darunter. */
export function legeZeileAn(k: BestandKontext, art: 'part' | 'fig', uid: number, schluessel: (string | number)[]) {
  return gemeinsamRepo.legeManuellAn(k.db, art, uid, schluessel);
}

export function teileDesKontos(k: BestandKontext, uid: number) {
  return gemeinsamRepo.manuelleTeileDesKontos(k.db, uid);
}

export function figurenDesKontos(k: BestandKontext, uid: number) {
  return gemeinsamRepo.manuelleFigurenDesKontos(k.db, uid);
}
