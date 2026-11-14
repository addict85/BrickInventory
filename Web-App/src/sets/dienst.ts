/** SQL, Rebrickable und Aufträge stehen nur hier und darunter, damit die Routen nur Anfrage und Antwort kennen. */
import { normalisiereLagerort } from '../bestand';
import { normalisiereSetNummer } from '../infra/setNummer';
import * as repo from './repository/setDetail';
import type { SetsKontext } from './kontext';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';

export async function rebrickableListe(sk: SetsKontext, uid: number) {
  const sets = await repo.setsMitMenge(sk.db, uid);
  return sets.map(s => ({ 'Set Number': s.set_number, Quantity: s.quantity }));
}

/** Eine Anleitung hängt per Fremdschlüssel am Set. */
export async function setGehoertKonto(sk: SetsKontext, uid: number, sn: string): Promise<boolean> {
  return !!(await repo.setDesKontos(sk.db, uid, sn));
}

/** Trifft alle Zeilen des Sets im Schreibbereich: Wer die Kiste packt, packt
 * sie für alle, die darin nachsehen. */
export async function lagerortDesSetsSetzen(
  sk: SetsKontext,
  uid: number,
  sn: string,
  storage: string | null | undefined,
) {
  const ort = normalisiereLagerort(storage);
  const n = await sk.bestand.lagerortDienst.setzeLagerort('set', { schreiber: uid }, [normalisiereSetNummer(sn)], ort);
  return { ort, n };
}

/** Die Liste kann über mehrere Konten spannen, die Vorgabe ist immer die des
 * Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung. */
export async function lagerorteMitVorgabe(sk: SetsKontext, uid: number, owner: string | undefined) {
  const [orte, vorgabe] = await Promise.all([
    sk.bestand.orteFuer(uid, owner),
    sk.bestand.lagerortDienst.vorgabeVon(uid),
  ]);
  return { orte, vorgabe };
}
