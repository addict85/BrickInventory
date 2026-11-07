/** Der Stand der Ersteinrichtung für die Anmeldeseite: Sie zeigt ohne Konto,
 * was noch fehlt, und erklärt die Installation des Wurzelzertifikats. Bis die
 * Einrichtung abgeschlossen ist, sind das nur Schalter — keine Namen, keine
 * Adressen, keine Schlüssel. Danach antwortet die Seite nur noch „erledigt"
 * und nennt das Zertifikat, das ohnehin unter /ca.crt öffentlich ist. */
import { kontenStand, datenbankErreichbar } from './repository/einrichtung';
import { konfig } from '../infra/konfig';
import { meldeUndLiefere } from '../infra/fehler';
import { tlsStand } from '../infra/tlsWurzel';
import { getGlobalSetting } from '../einstellungen/settings';

export type SchrittId = 'datenbank' | 'basis_url' | 'https' | 'ca' | 'konto' | 'quelle';
export interface Schrittzustand {
  id: SchrittId;
  ok: boolean;
  pflicht: boolean;
}

export interface EinrichtungStandAntwort {
  success: true;
  erledigt: boolean;
  konfiguriert: boolean;
  schritte: Schrittzustand[];
  ca: { vorhanden: boolean; fp_hex?: string; gueltig_bis?: string; download: string };
  basis_url: string | null;
  https: boolean;
}

/** Ein Fehler beim Prüfen ist selbst eine Auskunft: Die Zeile steht dann auf
 * „fehlt", und das Protokoll nennt den Grund. */
export async function einrichtungStand(): Promise<EinrichtungStandAntwort> {
  const ca = await tlsStand();
  const k = konfig();
  // "Konfiguriert" blendet den Prüfknopf auf der Anmeldeseite aus. BrickLink zählt
  // wie in /settings/einrichtung erst mit allen vier Werten: Ein halber Eintrag
  // ist keine Einrichtung, und dann soll der Weg zur Prüfung offen bleiben.
  const da = async (key: string) => !!(await getGlobalSetting(key).catch(meldeUndLiefere('einrichtung:quelle', null)));
  const rebrickable = await da('rebrickable_api_key');
  const bricklink = (
    await Promise.all(
      ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(da),
    )
  ).every(Boolean);
  const antwort: EinrichtungStandAntwort = {
    success: true,
    erledigt: false,
    konfiguriert: rebrickable || bricklink,
    schritte: [],
    ca: {
      vorhanden: !!ca,
      ...(ca ? { fp_hex: ca.fp_hex, gueltig_bis: ca.gueltig_bis } : {}),
      download: '/ca.crt',
    },
    basis_url: k.appBaseUrl,
    https: k.hinterTls,
  };

  const erledigt = !!(await getGlobalSetting('einrichtung_erledigt').catch(
    meldeUndLiefere('einrichtung:erledigt', null),
  ));
  if (erledigt) return { ...antwort, erledigt: true };

  const schritte: Schrittzustand[] = [];
  const datenbank = await datenbankErreichbar()
    .then(() => true)
    .catch(meldeUndLiefere('einrichtung:datenbank', false));
  schritte.push({ id: 'datenbank', ok: datenbank, pflicht: true });
  schritte.push({ id: 'basis_url', ok: !!k.appBaseUrl, pflicht: true });
  schritte.push({ id: 'https', ok: k.hinterTls, pflicht: false });
  schritte.push({ id: 'ca', ok: !!ca, pflicht: !!k.hinterTls });
  const konten = await kontenStand().catch(
    meldeUndLiefere('einrichtung:konten', { vorhanden: false, startpasswort: false }),
  );
  schritte.push({ id: 'konto', ok: konten.vorhanden && !konten.startpasswort, pflicht: true });
  schritte.push({ id: 'quelle', ok: rebrickable, pflicht: true });

  return { ...antwort, schritte };
}
