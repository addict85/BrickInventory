/** Relativ (`quantity_delta`) für Geräte, die offline sammeln: Zwei
 * gleichzeitige „+1" ergeben +2, eine absolute Menge aus altem Stand
 * überschriebe den anderen Zugang. */
import { withInventoryLock, bestandsSchluessel } from '../../db/txLock';
import { bestandsMenge } from '../infra/validate';
import { fachfehler } from '../infra/fehlerTexte';
import { meldeUndLiefere } from '../infra/fehler';
import { recordAcquisitionForDay } from './acquisitions';
import * as repo from './repository/manuelleMengen';
import type { ManuelleArt } from './repository/manuelleMengen';

/** Ein manueller Eintrag verschwindet nur über Löschen, nie über die Menge. */
const MINDESTENS = 1;

export type Mengenwunsch = { absolut: number } | { delta: number };

/** quantity_delta gewinnt, wenn beides kommt. */
export function mengenwunsch(body: { quantity?: unknown; quantity_delta?: unknown }): Mengenwunsch | null {
  if (body.quantity_delta !== undefined && body.quantity_delta !== null) {
    const delta = Number(body.quantity_delta);
    if (!Number.isInteger(delta) || Math.abs(delta) > 9999) fachfehler('ungueltig', 'wert_ungueltig');
    return { delta };
  }
  if (body.quantity !== undefined) return { absolut: bestandsMenge(body.quantity, MINDESTENS) };
  return null;
}

const ziel = (w: Mengenwunsch, bisher: number) =>
  'absolut' in w ? w.absolut : Math.max(MINDESTENS, bisher + w.delta);

/** In der Bestandssperre gerechnet, damit sich Web und App nicht überholen.
 * @param marktpreis wird VOR der Sperre und nur bei steigender Menge gefragt
 * @returns die Menge danach */
export async function passeManuelleMengeAn(art: ManuelleArt, uid: number, schluessel: (string | number)[],
                                            wunsch: Mengenwunsch, zustand: string,
                                            marktpreis: () => Promise<number | null>): Promise<number> {
  const vorab = await repo.summeDerErfassungen(art, uid, schluessel);
  const mp = ziel(wunsch, vorab) > vorab
    ? await marktpreis().catch(meldeUndLiefere(`manuelle-menge:marktpreis ${art}`, null)) : null;
  return withInventoryLock(uid, bestandsSchluessel(art, schluessel), async (tx) => {
    const erfassungen = await repo.erfassungenNeuesteZuerst(tx, art, uid, schluessel);
    const bisher = erfassungen.reduce((s, r) => s + r.quantity, 0);
    const soll = ziel(wunsch, bisher);
    if (soll > bisher) {
      await recordAcquisitionForDay(art, uid, schluessel,
        { quantity: soll - bisher, price: mp, condition: zustand, geschaetzt: true }, tx);
    }
    let rest = bisher - soll;
    for (const a of erfassungen) {
      if (rest <= 0) break;
      const weg = Math.min(a.quantity, rest);
      if (weg >= a.quantity) await repo.entferneErfassung(tx, art, a.id, [uid]);
      else await repo.kuerzeErfassung(tx, art, a.id, weg, [uid]);
      rest -= weg;
    }
    return soll;
  });
}
