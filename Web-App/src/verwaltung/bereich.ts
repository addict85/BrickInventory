/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as aufraeumen from './aufraeumen';
import * as datenexport from './datenexport';
import * as diagnose from './diagnose';
import * as dienst from './dienst';
import * as gesundheit from './gesundheit';
import * as jobUebersicht from './jobUebersicht';
import * as einstellungenSpeichern from './einstellungenSpeichern';
import * as hintergrund from './hintergrund';
import * as startNachlaeufe from './startNachlaeufe';
import { zugang, type VerwaltungAbhaengigkeiten, type VerwaltungKontext } from './kontext';

export type { VerwaltungAbhaengigkeiten, VerwaltungKontext } from './kontext';

export function erzeugeVerwaltung(a: VerwaltungAbhaengigkeiten, einblick?: Einblick<VerwaltungKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: VerwaltungKontext) => ({
      aufraeumen: mit(k)(aufraeumen.aufraeumen),
      aufraeumenTaeglich: mit(k)(aufraeumen.aufraeumenTaeglich),
      datenZip: mit(k)(datenexport.datenZip),
      konfigImport: mit(k)(datenexport.konfigImport),
      konfigExport: mit(k)(datenexport.konfigExport),
      preisProbe: mit(k)(diagnose.preisProbe),
      bildDiagnose: mit(k)(diagnose.bildDiagnose),
      cacheStatistik: mit(k)(dienst.cacheStatistik),
      anleitungenNeuEinreihen: mit(k)(dienst.anleitungenNeuEinreihen),
      preisJobStand: mit(k)(dienst.preisJobStand),
      katalogBilderEinreihen: mit(k)(dienst.katalogBilderEinreihen),
      bildFehlanzeigenVergessen: mit(k)(dienst.bildFehlanzeigenVergessen),
      serverProtokollSeit: mit(k)(dienst.serverProtokollSeit),
      cachesLeeren: mit(k)(dienst.cachesLeeren),
      bricksetLimitGesetzt: mit(k)(dienst.bricksetLimitGesetzt),
      preisJobJetzt: mit(k)(dienst.preisJobJetzt),
      fehlendeBilderNachladen: mit(k)(dienst.fehlendeBilderNachladen),
      katalogAbgleichJetzt: mit(k)(dienst.katalogAbgleichJetzt),
      bricksetWiederholen: mit(k)(dienst.bricksetWiederholen),
      bricksetEntfernen: mit(k)(dienst.bricksetEntfernen),
      jobZeitplanSetzen: mit(k)(dienst.jobZeitplanSetzen),
      quellePruefen: mit(k)(dienst.quellePruefen),
      gesundheitsBericht: mit(k)(gesundheit.gesundheitsBericht),
      datenbankBereit: mit(k)(gesundheit.datenbankBereit),
      jobUebersicht: mit(k)(jobUebersicht.jobUebersicht),
      einstellungenSpeichern: mit(k)(einstellungenSpeichern.einstellungenSpeichern),
      auftragsUebersicht: mit(k)(hintergrund.auftragsUebersicht),
      auftragsArtLeeren: mit(k)(hintergrund.auftragsArtLeeren),
      nachlauf: mit(k)(startNachlaeufe.nachlauf),
    }),
    einblick,
  );
}

export type VerwaltungDienste = ReturnType<typeof erzeugeVerwaltung>;
