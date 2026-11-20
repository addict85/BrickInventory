/** Anleitungen eines Sets: hochgeladene und automatisch geholte. */
import { withoutMissingFile } from '../infra/error';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from '../infra/appPaths';
import { mergeInstructions } from '../catalog';
import { findSetInScope } from './addSet';
import { normalisiereSetNummer, possibleSetNumber } from '../infra/setNumber';
import { fachfehler, notFound } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import * as repo from './repository/setDetail';
import { versuche, valueOr } from '../infra/result';
import type { SetsContext } from './context';

export async function rememberInstruction(
  sk: SetsContext,
  uid: number,
  sn: string,
  pfad: string,
  beschreibung: string,
) {
  await repo.addInstructionOne(sk.db, uid, sn, pfad, beschreibung, pfad);
}

/** Die Datei bleibt, solange eine andere Zeile auf sie zeigt. */
export async function anleitungLoeschen(sk: SetsContext, uid: number, id: number): Promise<void> {
  const instr = (await repo.instructionPath(sk.db, id, uid)) ?? notFound();
  await repo.loescheAnleitung(sk.db, id, uid);
  if (!instr.local_path?.startsWith('/data/uploads/')) return;
  // Weiss die Datenbank nicht, ob noch jemand die Datei braucht, bleibt sie liegen. Die
  // Zeile eines anderen Kontos verbirgt der Zeilenschutz; gefragt wird deshalb im Systemrahmen.
  const pfad = instr.local_path;
  const rest = valueOr(
    await versuche(
      'sets:anleitung-noch-benutzt',
      inSystemContext('geteilte Anleitungsdatei', () => repo.instructionFileUsed(sk.db, pfad)),
    ),
    { ok: 1 },
  );
  // Der Eintrag ist schon weg; eine liegen gebliebene Datei kostet nur Platz.
  if (!rest)
    await fs.promises
      .unlink(path.join(APP_ROOT, instr.local_path.slice(1)))
      .catch(withoutMissingFile('anleitung:datei-loeschen'));
}

/** Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
 * Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag. */
export async function loadInstructionsNew(sk: SetsContext, uid: number, roh: string, verwalter: boolean) {
  const sn = normalisiereSetNummer(roh);
  if (!possibleSetNumber(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  if (verwalter) await sk.catalog.deleteInstructions(sn);
  else {
    if (!(await findSetInScope(sk, uid, sn))) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
    if ((await sk.catalog.anzahlAnleitungen(sn)) > 0) fachfehler('verboten', 'nur_admins');
    if (!(await sk.catalog.instructionNewLoadAllowed(sn)))
      fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  const auftrag = await sk.catalog.anleitungEinreihen(sn, { jetzt: true });
  const instructions = mergeInstructions(await sk.catalog.instructionsToSet(sn), []);
  return { instructions, auftrag };
}

/** Hochgeladene Anleitungen liegen je Konto in einem eigenen Ordner darunter. */
export const ANLEITUNGS_WURZEL = path.join(DATA_DIR, 'uploads');
