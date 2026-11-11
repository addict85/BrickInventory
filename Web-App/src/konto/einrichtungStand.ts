/** Der Stand der Ersteinrichtung für die Anmeldeseite: Sie zeigt ohne Konto,
 * was noch fehlt, und erklärt die Installation des Wurzelzertifikats. Bis die
 * Einrichtung abgeschlossen ist, sind das nur Schalter — keine Namen, keine
 * Adressen, keine Schlüssel. Danach antwortet die Seite nur noch „erledigt"
 * und nennt das Zertifikat, das ohnehin unter /ca.crt öffentlich ist. */
import { kontenStand, datenbankErreichbar } from './repository/einrichtung';
import { konfig } from '../infra/konfig';
import { Abstriche, versuche } from '../infra/ergebnis';
import { tlsStand } from '../infra/tlsWurzel';
import { getGlobalSetting, beiGlobalerAenderung } from '../einstellungen';

export type SchrittId = 'datenbank' | 'basis_url' | 'https' | 'ca' | 'konto' | 'quelle';
export interface Schrittzustand {
  id: SchrittId;
  ok: boolean;
  pflicht: boolean;
}

export interface EinrichtungStandAntwort {
  erledigt: boolean;
  konfiguriert: boolean;
  schritte: Schrittzustand[];
  ca: { vorhanden: boolean; fp_hex?: string; gueltig_bis?: string; download: string };
  basis_url: string | null;
  https: boolean;
  degradiert?: string[];
}

/** Die Seite ist öffentlich und kostet je Aufruf rund zehn Abfragen (Entschlüsselung,
 * Kontenzählung): Es rechnet der erste Aufruf je Fenster, auch bei gleichzeitigen. */
const ZWISCHENSPEICHER_MS = 5000;
const _gemerkt = new Map<boolean, { bis: number; antwort: Promise<EinrichtungStandAntwort> }>();

export function einrichtungStandVergessen(): void {
  _gemerkt.clear();
}
beiGlobalerAenderung(einrichtungStandVergessen);

/** Ein Fehler beim Prüfen ist selbst eine Auskunft: Die Zeile steht dann auf
 * „fehlt", `degradiert` nennt den Teil und das Protokoll den Grund.
 * Ohne Verwalter (`verwalter: false`) fehlen Basis-URL und Startpasswort: Wer die
 * Seite nur erreicht, soll nicht erfahren, dass ein Konto noch das Startpasswort trägt.
 * Beide Antworten werden getrennt gemerkt, sonst sähe die öffentliche Seite die des Verwalters. */
export function einrichtungStand({ verwalter = false } = {}): Promise<EinrichtungStandAntwort> {
  const jetzt = Date.now();
  const alt = _gemerkt.get(verwalter);
  if (alt && alt.bis > jetzt) return alt.antwort;
  const antwort = berechne(verwalter);
  _gemerkt.set(verwalter, { bis: jetzt + ZWISCHENSPEICHER_MS, antwort });
  antwort.catch(() => {
    if (_gemerkt.get(verwalter)?.antwort === antwort) _gemerkt.delete(verwalter);
  });
  return antwort;
}

async function berechne(verwalter: boolean): Promise<EinrichtungStandAntwort> {
  const ca = await tlsStand();
  const k = konfig();
  const grund = {
    ca: {
      vorhanden: !!ca,
      ...(ca ? { fp_hex: ca.fp_hex, zert_sha256: ca.zert_sha256, gueltig_bis: ca.gueltig_bis } : {}),
      download: '/ca.crt',
    },
    basis_url: verwalter ? k.appBaseUrl : null,
    https: k.hinterTls,
  };

  // Was sich nicht lesen liess, steht auf „fehlt“ und in `degradiert`; nur die
  // Datenbankzeile ist selbst die Probe.
  const ab = new Abstriche();
  const erledigt = !!(await ab.oder('erledigt', getGlobalSetting('einrichtung_erledigt'), null));
  // Nach der Einrichtung entfällt das Entschlüsseln der Schlüssel.
  if (erledigt) return { ...grund, erledigt: true, konfiguriert: true, schritte: [] };

  // BrickLink zählt erst mit allen vier Werten, wie in /settings/einrichtung.
  const da = async (key: string) => !!(await ab.oder('quelle', getGlobalSetting(key), null));
  const rebrickable = await da('rebrickable_api_key');
  const bricklink = (
    await Promise.all(
      ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(da),
    )
  ).every(Boolean);

  const schritte: Schrittzustand[] = [];
  const datenbank = (await versuche('einrichtung:datenbank', datenbankErreichbar())).ok;
  schritte.push({ id: 'datenbank', ok: datenbank, pflicht: true });
  schritte.push({ id: 'basis_url', ok: !!k.appBaseUrl, pflicht: true });
  schritte.push({ id: 'https', ok: k.hinterTls, pflicht: false });
  schritte.push({ id: 'ca', ok: !!ca, pflicht: !!k.hinterTls });
  const konten = await ab.oder('konten', kontenStand(), { vorhanden: false, startpasswort: false });
  schritte.push({ id: 'konto', ok: konten.vorhanden && (!verwalter || !konten.startpasswort), pflicht: true });
  schritte.push({ id: 'quelle', ok: rebrickable, pflicht: true });

  return { ...grund, erledigt: false, konfiguriert: rebrickable || bricklink, schritte, ...ab.angabe() };
}
