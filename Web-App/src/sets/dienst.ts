/** SQL, Rebrickable und Aufträge stehen nur hier und darunter, damit die Routen nur Anfrage und Antwort kennen. */
import { schreibziel } from '../haushalt';
import { normalisiereLagerort, setzeLagerort, orteFuer, vorgabeVon } from '../bestand';
import { normalizeSetNumber } from './erfassen';
import { mitVersion } from '../infra/setNummer';
import { verschiebeSet } from './setMove';
import { fachfehler } from '../infra/fehlerTexte';
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
export async function lagerortDesSetsSetzen(uid: number, sn: string, storage: string | null | undefined) {
  const ort = normalisiereLagerort(storage);
  const n = await setzeLagerort('set', { schreiber: uid }, [normalizeSetNumber(sn)], ort);
  return { ort, n };
}

/** Die Liste kann über mehrere Konten spannen, die Vorgabe ist immer die des
 * Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung. */
export async function lagerorteMitVorgabe(uid: number, owner: string | undefined) {
  const [orte, vorgabe] = await Promise.all([orteFuer(uid, owner), vorgabeVon(uid)]);
  return { orte, vorgabe };
}

/** Konto als Kennung aus der Eingabe; schreibziel() prüft es. */
type KontoWunsch = string | number | null | undefined;

/** Drei Erfassungen sind drei Käufe und können im Haushalt verschiedenen Kindern
 * gehören; wer alles will, wählt alle Zeilen. */
export async function setVerschieben(
  sk: SetsKontext,
  uid: number,
  roh: string,
  von: KontoWunsch,
  nach: KontoWunsch,
  erfassungen: number[],
) {
  if (!erfassungen.length) fachfehler('ungueltig', 'kaufpreise_angeben');
  const sn = mitVersion(roh);
  const fromId = await schreibziel(uid, von ?? uid);
  const toId = await schreibziel(uid, nach);
  if (fromId === toId) fachfehler('ungueltig', 'quelle_ziel_identisch');
  return {
    set_number: sn,
    from_user_id: fromId,
    to_user_id: toId,
    ...(await verschiebeSet(sk, sn, fromId, toId, erfassungen)),
  };
}
