/** Der eine Weg zu clients/. Was Schlüssel, Kontingent oder Drossel braucht, entsteht in
 * baueQuellen() je Zugang; der Rest steht hier als Export. */
import type { KlientenZugang } from '../../clients/zugang';
import { erzeugeBricklink } from '../../clients/bricklink';
import { erzeugeBrickset } from '../../clients/brickset';
import { downloadFile, erzeugeRebrickable, rebrickableRoh } from '../../clients/rebrickable';
import { produktTitel } from '../../clients/upcitemdb';
import { widerrufslisteAbruf } from '../../clients/googleAttestation';

export { alsAbrufFehler } from '../../clients/abrufFehler';
export { BricklinkNichtErreichbar } from '../../clients/bricklink';
export { EZB_HISTORIE, EZB_TAGESKURSE, ersteZipDatei, historieLesen, tageskurseLesen } from '../../clients/ezb';
export { RebrickableGesperrt, ersteBlNummer, parseThrottleWait } from '../../clients/rebrickable';
export { RbSet, RbSetFigur, rbSeite } from '../../clients/antworten';
import { ladeKatalogCsv } from '../../clients/rebrickableCsv';
import { oeffneBild, holeBild } from '../../clients/bildCdn';
import { ezbAbruf } from '../../clients/ezb';
export { BILD_KOPFZEILEN, BILD_KOPFZEILEN_OHNE_REFERER } from '../../clients/bildCdn';
import { legoAbruf } from '../../clients/legoGuthaben';
export { legoAbruf };
export { ERLAUBTE_GUTHABEN_HOSTS, type LegoAbruf } from '../../clients/legoGuthaben';
export type { Abruf, Kurs } from '../../clients/ezb';
export type { RbSetTeil } from '../../clients/rebrickable';
export type { KlientenZugang } from '../../clients/zugang';

/** Die Klienten eines Zugangs, flach wie früher die Exporte; `getSetInfo` ist der von
 * Brickset, `brickset` die ganze Gruppe für die Anleitungen (getInstructions). */
export function baueQuellen(z: KlientenZugang) {
  const rb = erzeugeRebrickable(z);
  const bs = erzeugeBrickset(z);
  const bl = erzeugeBricklink(z);
  return {
    ...rb,
    ...bl,
    ausRetryWarteschlange: bs.ausRetryWarteschlange,
    getSetByBarcode: bs.getSetByBarcode,
    getSetByEan: bs.getSetByEan,
    getSetInfo: bs.getSetInfo,
    pruefeBricksetZugang: bs.pruefeBricksetZugang,
    brickset: bs,
    produktTitel: (ean13: string) => produktTitel(rb.httpsGetRobust, ean13),
    ladeKatalogCsv,
    /** Ohne Schlüssel; hier, damit ein Test ihn je Satz Dienste ersetzt (testQuellen). */
    legoAbruf,
    widerrufslisteAbruf,
    downloadFile,
    rebrickableRoh,
    oeffneBild,
    holeBild,
    ezbAbruf,
  };
}

export type Quellen = ReturnType<typeof baueQuellen>;
