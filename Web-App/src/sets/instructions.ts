/** A set's instructions: uploaded and automatically fetched ones. */
import { withoutMissingFile } from '../infra/error';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from '../infra/appPaths';
import { mergeInstructions } from '../catalog';
import { findSetInScope } from './addSet';
import { normalizeSetNumber, possibleSetNumber } from '../infra/setNumber';
import { failDomain, notFound } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import * as repo from './repository/setDetail';
import { attempts, valueOr } from '../infra/result';
import type { SetsContext } from './context';

export async function rememberInstruction(
  sk: SetsContext,
  uid: number,
  sn: string,
  filePath: string,
  description: string,
) {
  await repo.addInstructionOne(sk.db, uid, sn, filePath, description, filePath);
}

/** The file stays as long as another row points to it. */
export async function deleteInstruction(sk: SetsContext, uid: number, id: number): Promise<void> {
  const instr = (await repo.instructionPath(sk.db, id, uid)) ?? notFound();
  await repo.deleteInstructionRow(sk.db, id, uid);
  if (!instr.local_path?.startsWith('/data/uploads/')) return;
  // If the database does not know whether anyone still needs the file, it stays. Another
  // account's row is hidden by row security; that is why the question is asked in the system frame.
  const filePath = instr.local_path;
  const rest = valueOr(
    await attempts(
      'sets:anleitung-noch-benutzt',
      inSystemContext('geteilte Anleitungsdatei', () => repo.instructionFileUsed(sk.db, filePath)),
    ),
    { ok: 1 },
  );
  // The entry is already gone; a leftover file only costs space.
  if (!rest)
    await fs.promises
      .unlink(path.join(APP_ROOT, instr.local_path.slice(1)))
      .catch(withoutMissingFile('anleitung:datei-loeschen'));
}

/** The instructions are shared: only the admin may replace them (an empty
 * fetch would otherwise delete them for everyone). Others fetch what is missing, once per set and day. */
export async function loadInstructionsNew(sk: SetsContext, uid: number, raw: string, admin: boolean) {
  const sn = normalizeSetNumber(raw);
  if (!possibleSetNumber(sn)) failDomain('ungueltig', 'setnummer_ungueltig');
  if (admin) await sk.catalog.deleteInstructions(sn);
  else {
    if (!(await findSetInScope(sk, uid, sn))) failDomain('nicht_gefunden', 'set_nicht_gefunden');
    if ((await sk.catalog.instructionCount(sn)) > 0) failDomain('verboten', 'nur_admins');
    if (!(await sk.catalog.instructionNewLoadAllowed(sn)))
      failDomain('zu_viele', 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  const auftrag = await sk.catalog.enqueueInstruction(sn, { jetzt: true });
  const instructions = mergeInstructions(await sk.catalog.instructionsToSet(sn), []);
  return { instructions, auftrag };
}

/** Uploaded instructions live per account in a folder of its own below. */
export const INSTRUCTION_ROOT = path.join(DATA_DIR, 'uploads');
