/** Der eine Weg zu den Fremdquellen: Hier bekommen die Klienten Schlüssel, Kontingent,
 * Drossel und Wiedervorlage, damit clients/ keinen Bereich kennen muss. */
import { verdrahteKlienten } from '../../clients/zugang';
import { bricksetVormerken, bricksetAusWiedervorlage, BRICKSET_HOECHSTENS } from '../auftraege';
import { getGlobalSetting } from '../einstellungen';
import { checkAndIncrementRateLimit, getRateLimitStatus } from './apiKontingent';
import { rebrickableLimiter, rebrickableBackgroundLimiter, rebrickableDailyStatus } from './rateLimiter';

verdrahteKlienten({
  schluessel: async (name) => (await getGlobalSetting(name)) || '',
  zaehle: (api) => checkAndIncrementRateLimit(api),
  kontingentStand: (api) => api === 'rebrickable' ? rebrickableDailyStatus() : getRateLimitStatus(api),
  drossel: { vordergrund: rebrickableLimiter, hintergrund: rebrickableBackgroundLimiter },
  bricksetVormerken: async (sn, fehler, bald) => ({ ...await bricksetVormerken(sn, fehler, bald), hoechstens: BRICKSET_HOECHSTENS }),
  bricksetVergessen: bricksetAusWiedervorlage,
});

export { alsAbrufFehler } from '../../clients/abrufFehler';
export { bricklinkRequest, pruefeBricklinkZugang, BricklinkNichtErreichbar } from '../../clients/bricklink';
export { ausRetryWarteschlange, getSetByBarcode, getSetByEan, getSetInfo, pruefeBricksetZugang } from '../../clients/brickset';
export { EZB_HISTORIE, EZB_TAGESKURSE, ersteZipDatei, ezbAbruf, historieLesen, tageskurseLesen } from '../../clients/ezb';
export { blFilterWirkungslos, blTeilZuRb, downloadFile, parseThrottleWait, getBrickColors, getMinifigInfo, getRbKey, getSetMinifigs, getThemeName, holeFigurTeile, holeSet, holeSetTeile, httpsGetRobust, lookupPart, pruefeRebrickableZugang, rebrickableJson, scrapeInstructions } from '../../clients/rebrickable';
export { produktTitel } from '../../clients/upcitemdb';
export { ladeKatalogCsv } from '../../clients/rebrickableCsv';
export { oeffneBild, holeBild, BILD_KOPFZEILEN, BILD_KOPFZEILEN_OHNE_REFERER } from '../../clients/bildCdn';
export { legoAbruf, ERLAUBTE_GUTHABEN_HOSTS, type LegoAbruf } from '../../clients/legoGuthaben';
export { rebrickableRoh } from '../../clients/rebrickable';
export * as brickset from '../../clients/brickset';
export type { Abruf, Kurs } from '../../clients/ezb';
export type { RbSetTeil } from '../../clients/rebrickable';
