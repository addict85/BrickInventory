/** POST /settings ohne HTTP. Hier statt in src/einstellungen, weil Mail, Protokoll
 * und Brickset-Warteschlange höhere Stufen sind (test/schichten.test.js). */
import { SECRET_KEYS, isMaskedValue, globalerWertGueltig, meldeGlobaleAenderung } from '../einstellungen';
import { mailBereit } from '../mail';
import { fachfehler } from '../infra/fehlerTexte';
import { GLOBALE_EINSTELLUNGEN, KONTO_EINSTELLUNGEN } from '../vertrag/einstellungen';
import type { Eingabe } from '../vertrag';
import { istHeikel } from './datenexport';
import { bricksetLimitGesetzt } from './dienst';
import type { VerwaltungKontext } from './kontext';

type EinstellungsEingabe = Eingabe<'POST /api/v1/settings'>;

export interface Speichern {
  uid: number;
  name: string;
  /** Verwalter, und ein App-Token hat die Freigabe schon (Route). */
  verwalter: boolean;
  /** Passwort und Faktor; sendet bei `false` die Absage selbst. */
  bestaetige: (passwort: string | null | undefined) => Promise<boolean>;
}

/** Ob ein Verwalter-Teil vorliegt: Nur dann braucht ein App-Token die Freigabe. */
export const hatGlobaleWerte = (e: EinstellungsEingabe) => GLOBALE_EINSTELLUNGEN.some(k => e[k] !== undefined);

/** Mailserver, Registrierung und API-Schlüssel nur mit Passwort: Eine erbeutete
 * Verwaltersitzung läse sonst Rücksetz-Mails mit oder öffnete still die Registrierung.
 * Ein erster API-Schlüssel lenkt nichts um; nur der Einrichtungsassistent fragt dafür nicht nach. */
async function heikleSchluessel(k: VerwaltungKontext, e: EinstellungsEingabe): Promise<string[]> {
  const heikel: string[] = [];
  const einrichtung = !(await k.einstellungen.getGlobalSetting('einrichtung_erledigt'));
  for (const key of GLOBALE_EINSTELLUNGEN.filter(istHeikel)) {
    const neu = e[key];
    if (neu === undefined || (SECRET_KEYS.has(key) && isMaskedValue(neu))) continue;
    const alt = String((await k.einstellungen.getGlobalSetting(key)) ?? '');
    if (
      String(neu) === alt ||
      (einrichtung && alt === '' && !key.startsWith('smtp_') && key !== 'registration_enabled')
    )
      continue;
    heikel.push(key);
  }
  return heikel;
}

/** Eine unverändert zurückgeschickte Maske ist kein neuer Wert, sonst überschriebe
 * jedes Speichern die echten Schlüssel mit Punkten. */
async function schreibeGlobal(kx: VerwaltungKontext, uid: number, e: EinstellungsEingabe): Promise<void> {
  const geaendert: string[] = [];
  for (const key of GLOBALE_EINSTELLUNGEN) {
    if (e[key] === undefined || (SECRET_KEYS.has(key) && isMaskedValue(e[key]))) continue;
    if (String(e[key]) !== String((await kx.einstellungen.getGlobalSetting(key)) ?? '')) geaendert.push(key);
    await kx.einstellungen.setGlobalSetting(key, e[key]);
  }
  if (geaendert.length)
    await kx.konto.protokoll.protokolliere(uid, uid, 'einstellungen_geaendert', geaendert.join(', '));
  // Wer das Mailformular gespeichert hat, hat den Hinweis auf die alte Ausnahme gesehen.
  if (GLOBALE_EINSTELLUNGEN.some(k => k.startsWith('smtp_') && e[k] !== undefined))
    await kx.einstellungen.deleteGlobalSetting('smtp_insecure_tls');
}

/** Alle Schreibvorgänge samt Protokoll in einer Transaktion: Scheitert ein Wert,
 * steht keiner der anderen halb gespeichert da. @returns false nach einer Absage */
export async function einstellungenSpeichern(
  kx: VerwaltungKontext,
  e: EinstellungsEingabe,
  o: Speichern,
): Promise<boolean> {
  const global = o.verwalter && hatGlobaleWerte(e);
  if (global) {
    if (GLOBALE_EINSTELLUNGEN.some(k => e[k] !== undefined && !globalerWertGueltig(k, e[k])))
      fachfehler('ungueltig', 'wert_ungueltig');
    if (
      String(e.registration_enabled) === '1' &&
      (await kx.einstellungen.getGlobalSetting('registration_enabled')) !== '1' &&
      !(await mailBereit(e))
    )
      fachfehler('ungueltig', 'registrierung_braucht_mail');
  }
  const heikel = global ? await heikleSchluessel(kx, e) : [];
  if (heikel.length && !e.admin_password) fachfehler('ungueltig', 'aktuelles_passwort_erforderlich');
  if (heikel.length && !(await o.bestaetige(e.admin_password))) return false;

  // Die Währung gilt für den ganzen Haushalt und braucht deshalb den Systemrahmen, der
  // sich in einer Transaktion nicht betreten lässt: vorher und für sich. Scheitert sie,
  // ist noch nichts geschrieben; der Preis-Job folgt nur einer echten Änderung.
  if (e.currency !== undefined) await kx.konto.setUserSetting(o.uid, 'currency', e.currency);
  const bricksetAlt = await kx.transaktion(async t => {
    const alt =
      global && e.api_limit_brickset !== undefined
        ? parseInt((await t.einstellungen.getGlobalSetting('api_limit_brickset')) || '100', 10)
        : null;
    if (global) await schreibeGlobal(t, o.uid, e);
    for (const key of KONTO_EINSTELLUNGEN)
      if (key !== 'currency' && e[key] !== undefined) await t.konto.setUserSetting(o.uid, key, e[key]);
    return alt;
  });
  if (!global) return true;
  // Erst nach dem COMMIT: Ein Zwischenspeicher läse vorher noch den alten Wert ein.
  meldeGlobaleAenderung();
  if (heikel.some(k => !k.startsWith('smtp_')))
    kx.konto.verwalterHinweisNebenher('einstellungen_geaendert', { konto: heikel.join(', '), durch: o.name });
  if (bricksetAlt !== null) await bricksetLimitGesetzt(kx, bricksetAlt, parseInt(String(e.api_limit_brickset), 10));
  return true;
}
