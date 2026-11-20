/** Der eine Weg zu clients/. Was Schlüssel, Kontingent oder Drossel braucht, entsteht in
 * buildSources() je Zugang; der Rest steht hier als Export. */
import type { ClientsAccess } from '../../clients/access';
import { createBricklink } from '../../clients/bricklink';
import { createBrickset } from '../../clients/brickset';
import { downloadFile, createRebrickable, rebrickableRaw } from '../../clients/rebrickable';
import { productTitle } from '../../clients/upcitemdb';
import { revocationListFetch } from '../../clients/googleAttestation';

export { asFetchError } from '../../clients/fetchError';
export { BricklinkNotReachable } from '../../clients/bricklink';
export { ECB_HISTORY, ECB_DAILY_RATES, firstZipFile, readHistory, readDailyRates } from '../../clients/ecb';
export { RebrickableLocked, firstBlNumber, parseThrottleWait } from '../../clients/rebrickable';
export { RbSet, RbSetMinifig, rbPage } from '../../clients/responses';
import { loadCatalogCsv } from '../../clients/rebrickableCsv';
import { oeffneBild, fetchImage } from '../../clients/imageCdn';
import { ecbFetch } from '../../clients/ecb';
export { IMAGE_HEADERS, IMAGE_HEADERS_WITHOUT_REFERER } from '../../clients/imageCdn';
import { legoFetch } from '../../clients/legoBalance';
export { legoFetch };
export { ALLOWED_BALANCE_HOSTS, type LegoFetch } from '../../clients/legoBalance';
export type { Abruf, Kurs } from '../../clients/ecb';
export type { RbSetTeil } from '../../clients/rebrickable';
export type { ClientsAccess } from '../../clients/access';

/** Die Klienten eines Zugangs, flach wie früher die Exporte; `setAngaben` ist der von
 * Brickset, `brickset` die ganze Gruppe für die Anleitungen (getInstructions). */
export function buildSources(z: ClientsAccess) {
  const rb = createRebrickable(z);
  const bs = createBrickset(z);
  const bl = createBricklink(z);
  return {
    ...rb,
    ...bl,
    fromRetryQueue: bs.fromRetryQueue,
    getSetByBarcode: bs.getSetByBarcode,
    getSetByEan: bs.getSetByEan,
    setAngaben: bs.setAngaben,
    checkBricksetAccess: bs.checkBricksetAccess,
    brickset: bs,
    productTitle: (ean13: string) => productTitle(rb.httpsGetRobust, ean13),
    loadCatalogCsv,
    /** Ohne Schlüssel; hier, damit ein Test ihn je Satz Dienste ersetzt (testSources). */
    legoFetch,
    revocationListFetch,
    downloadFile,
    rebrickableRaw,
    oeffneBild,
    fetchImage,
    ecbFetch,
  };
}

export type Quellen = ReturnType<typeof buildSources>;
