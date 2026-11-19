/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import { mit, mitVertrag, type Kontext } from '../infra/bereich';
import type { KatalogLesevertrag } from './lesevertrag';
import type { Faecher } from '../infra/zwischenspeicher';
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import type { ConcurrentRateLimiter, FremdquellenDienste } from '../fremdquellen';
import type { AuftraegeDienste } from '../auftraege';
import type { SettingsServices } from '../settings';
import type { HaushaltDienste } from '../haushalt';
import type { BilderDienste } from '../bilder';
import * as anleitungen from './repository/anleitungen';
import * as bildlage from './repository/bildlage';
import * as blZuordnung from './repository/blZuordnung';
import * as csvKatalog from './repository/csvKatalog';
import * as katalogCache from './repository/katalogCache';
import * as katalogStamm from './repository/katalogStamm';
import * as katalogSuche from './repository/katalogSuche';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setInhalt from './repository/setInhalt';
import * as teileAnreicherung from './repository/teileAnreicherung';
import type { Uhr } from '../infra/uhr';

export interface KatalogAbhaengigkeiten {
  uhr: Uhr;
  db: Db;
  faecher: Faecher;
  /** Klienten, Kontingent und Drosseln dieses Satzes Dienste (src/fremdquellen). */
  fremdquellen: FremdquellenDienste;
  /** Höchstens zwei Bildabrufe beim CDN zugleich, je Satz Dienste einer. */
  cdnDrossel: ConcurrentRateLimiter;
  bilder: BilderDienste;
  einstellungen: SettingsServices;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  throttle: ThrottleServices;
  lesevertrag: KatalogLesevertrag;
}

/** Anleitungen, BrickLink-Zuordnung und CSV-Katalog. */
const anleitungszugang = (db: Db, l: KatalogLesevertrag) => ({
  anleitungen: {
    zaehleAnleitungen: mit(db)(anleitungen.zaehleAnleitungen),
    anleitungenDesSets: mit(db)(anleitungen.anleitungenDesSets),
    loescheAnleitungenDesSets: mit(db)(anleitungen.loescheAnleitungenDesSets),
    hatBrickinstructions: mit(db)(anleitungen.hatBrickinstructions),
    merkeAnleitung: mit(db)(anleitungen.merkeAnleitung),
    setzeAnleitungsdatei: mit(db)(anleitungen.setzeAnleitungsdatei),
  },
  blZuordnung: {
    schreibeBlNummer: mit(db)(blZuordnung.schreibeBlNummer),
    schreibeBlNummerEigen: mit(db)(blZuordnung.schreibeBlNummerEigen),
    notiereNachgesehen: mit(db)(blZuordnung.notiereNachgesehen),
    abweichendeNummer: mit(db)(blZuordnung.abweichendeNummer),
    wirksameNummer: mit(db)(blZuordnung.wirksameNummer),
    wirksameNummern: mit(db)(blZuordnung.wirksameNummern),
    schreibeBlFarbnummer: mit(db)(blZuordnung.schreibeBlFarbnummer),
  },
  csvKatalog: {
    katalogBildstand: mit(db)(csvKatalog.katalogBildstand),
    inventarTeileOhneErsatz: mit(db)(csvKatalog.inventarTeileOhneErsatz),
    inventarFiguren: mit(db)(csvKatalog.inventarFiguren),
    setsOhneTeilekatalog: mit(db)(csvKatalog.setsOhneTeilekatalog),
    manuelleFarbteile: mitVertrag(db, l)(csvKatalog.manuelleFarbteile),
    ersetzeTeilfarbenbild: mit(db)(csvKatalog.ersetzeTeilfarbenbild),
  },
  katalogCache: {
    katalogEintragZu: mit(db)(katalogCache.katalogEintragZu),
    setImKatalog: mit(db)(katalogCache.setImKatalog),
    merkeBricklinkArt: mit(db)(katalogCache.merkeBricklinkArt),
    leereSubsetsCache: mit(db)(katalogCache.leereSubsetsCache),
    leereKatalogCache: mit(db)(katalogCache.leereKatalogCache),
    cacheZahlen: mit(db)(katalogCache.cacheZahlen),
    blTypenDerSets: mit(db)(katalogCache.blTypenDerSets),
    merkeBlTyp: mit(db)(katalogCache.merkeBlTyp),
  },
});

/** Stamm, Suche, Zwischenspeicher und Inhalt der Sets. */
const stammzugang = (db: Db, l: KatalogLesevertrag) => ({
  katalogStamm: {
    inventarNachKandidaten: mit(db)(katalogStamm.inventarNachKandidaten),
    geladeneFarben: mit(db)(katalogStamm.geladeneFarben),
    teilAusKatalog: mit(db)(katalogStamm.teilAusKatalog),
    figurAusKatalog: mit(db)(katalogStamm.figurAusKatalog),
  },
  katalogSuche: {
    themen: mit(db)(katalogSuche.themen),
    setsJeThema: mit(db)(katalogSuche.setsJeThema),
    jahresspanne: mit(db)(katalogSuche.jahresspanne),
    setsJeJahr: mit(db)(katalogSuche.setsJeJahr),
    setsJeJahrGefiltert: mit(db)(katalogSuche.setsJeJahrGefiltert),
    katalogAnzahl: mit(db)(katalogSuche.katalogAnzahl),
    katalogZeilen: mitVertrag(db, l)(katalogSuche.katalogZeilen),
    katalogZeile: mitVertrag(db, l)(katalogSuche.katalogZeile),
    katalogLeer: mit(db)(katalogSuche.katalogLeer),
    figurenImInventar: mit(db)(katalogSuche.figurenImInventar),
  },
  rebrickableCache: {
    katalogSetZu: mit(db)(rebrickableCache.katalogSetZu),
    merkeUnbekanntesSet: mit(db)(rebrickableCache.merkeUnbekanntesSet),
    merkeSet: mit(db)(rebrickableCache.merkeSet),
    teilelisteAusCache: mit(db)(rebrickableCache.teilelisteAusCache),
    merkeTeileliste: mit(db)(rebrickableCache.merkeTeileliste),
    figurenteileAusCache: mit(db)(rebrickableCache.figurenteileAusCache),
    merkeFigurenteile: mit(db)(rebrickableCache.merkeFigurenteile),
    inventarTeile: mit(db)(rebrickableCache.inventarTeile),
  },
  setInhalt: {
    figurenDesSetkatalogs: mit(db)(setInhalt.figurenDesSetkatalogs),
    teileOhneBlZuordnung: mitVertrag(db, l)(setInhalt.teileOhneBlZuordnung),
  },
  teileAnreicherung: {
    teileDesInventars: mit(db)(teileAnreicherung.teileDesInventars),
    setTeileKatalog: mit(db)(teileAnreicherung.setTeileKatalog),
    blZuordnungen: mit(db)(teileAnreicherung.blZuordnungen),
    figurenImSetkatalog: mit(db)(teileAnreicherung.figurenImSetkatalog),
    bilderOhneDatei: mit(db)(teileAnreicherung.bilderOhneDatei),
    figurenDesSets: mit(db)(teileAnreicherung.figurenDesSets),
    inventareDerFiguren: mit(db)(teileAnreicherung.inventareDerFiguren),
    lokaleBilderMitAdresse: mit(db)(teileAnreicherung.lokaleBilderMitAdresse),
    vergissLokalesBild: mit(db)(teileAnreicherung.vergissLokalesBild),
    sperrVerbindung: mit(db)(teileAnreicherung.sperrVerbindung),
  },
});

const bildzugang = (db: Db, l: KatalogLesevertrag) => ({
  bildlage: {
    setsMitFehlendenKatalogbildern: mit(db)(bildlage.setsMitFehlendenKatalogbildern),
    manuelleTeileOhneBild: mitVertrag(db, l)(bildlage.manuelleTeileOhneBild),
    figurenOhneBild: mitVertrag(db, l)(bildlage.figurenOhneBild),
    setBilderOhneDatei: mitVertrag(db, l)(bildlage.setBilderOhneDatei),
    merkeSetBildLokal: mit(db)(bildlage.merkeSetBildLokal),
    lokaleKatalogbilder: mit(db)(bildlage.lokaleKatalogbilder),
    teilbilder: mit(db)(bildlage.teilbilder),
    figurenbilder: mit(db)(bildlage.figurenbilder),
    fuelleSetLuecken: mit(db)(bildlage.fuelleSetLuecken),
    setsOhneAnleitungsabruf: mitVertrag(db, l)(bildlage.setsOhneAnleitungsabruf),
    fehlendeKatalogbilder: mit(db)(bildlage.fehlendeKatalogbilder),
    setNamen: mit(db)(bildlage.setNamen),
  },
});

export const zugang = (db: Db, l: KatalogLesevertrag) => ({
  ...anleitungszugang(db, l),
  ...stammzugang(db, l),
  ...bildzugang(db, l),
});
export type KatalogKontext = Kontext<KatalogAbhaengigkeiten, ReturnType<typeof zugang>>;
