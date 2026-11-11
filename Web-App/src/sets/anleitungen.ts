/** Anleitungen eines Sets: hochgeladene und automatisch geholte. */
import { ohneFehlendeDatei } from '../infra/fehler';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, DATA_DIR } from '../infra/appPaths';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import {
  anleitungenZuSet,
  anleitungenZusammenlegen,
  loescheAnleitungen,
  anleitungNeuLadenErlaubt,
  anzahlAnleitungen,
} from '../katalog/instructions';
import { findSetInScope } from './erfassen';
import { normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/setDetail';
import { versuche, wertOder } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

export async function anleitungMerken(sk: SetsKontext, uid: number, sn: string, pfad: string, beschreibung: string) {
  await repo.fuegeAnleitungEin(sk.db, uid, sn, pfad, beschreibung, pfad);
}

/** Die Datei bleibt, solange eine andere Zeile auf sie zeigt.
 * @returns false, wenn es die Zeile nicht gab */
export async function anleitungLoeschen(sk: SetsKontext, uid: number, id: string): Promise<boolean> {
  const instr = await repo.anleitungsPfad(sk.db, id, uid);
  if (!instr) return false;
  await repo.loescheAnleitung(sk.db, id, uid);
  if (!instr.local_path?.startsWith('/data/uploads/')) return true;
  // Weiss die Datenbank nicht, ob noch jemand die Datei braucht, bleibt sie liegen.
  const rest = wertOder(
    await versuche('sets:anleitung-noch-benutzt', repo.anleitungsdateiBenutzt(sk.db, instr.local_path)),
    { ok: 1 },
  );
  // Der Eintrag ist schon weg; eine liegen gebliebene Datei kostet nur Platz.
  if (!rest)
    await fs.promises
      .unlink(path.join(APP_ROOT, instr.local_path.slice(1)))
      .catch(ohneFehlendeDatei('anleitung:datei-loeschen'));
  return true;
}

/** Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
 * Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag. */
export async function anleitungenNeuLaden(sk: SetsKontext, uid: number, roh: string, verwalter: boolean) {
  const sn = normalisiereSetNummer(roh);
  if (!moeglicheSetNummer(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  if (verwalter) await loescheAnleitungen(sn);
  else {
    if (!(await findSetInScope(sk, uid, sn))) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
    if ((await anzahlAnleitungen(sn)) > 0) fachfehler('verboten', 'nur_admins');
    if (!(await anleitungNeuLadenErlaubt(sn))) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  const auftrag = await anleitungEinreihen(sn, { jetzt: true });
  const instructions = anleitungenZusammenlegen(await anleitungenZuSet(sn), []);
  return { instructions, auftrag };
}

/** Hochgeladene Anleitungen liegen je Konto in einem eigenen Ordner darunter. */
export const ANLEITUNGS_WURZEL = path.join(DATA_DIR, 'uploads');
