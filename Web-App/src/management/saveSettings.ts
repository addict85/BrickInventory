/** POST /settings ohne HTTP. Hier statt in src/settings, weil Mail, Protokoll
 * und Brickset-Warteschlange höhere Stufen sind (test/schichten.test.js). */
import { SECRET_KEYS, isMasked, isValidGlobalValue } from '../settings';
import { fachfehler } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import { GLOBAL_SETTINGS, ACCOUNT_SETTINGS } from '../contract/settings';
import type { Eingabe } from '../contract';
import { isSensitive } from './dataExport';
import { bricksetLimitSet } from './service';
import type { ManagementContext } from './context';

type SettingsInput = Eingabe<'POST /api/v1/settings'>;

export interface SaveSettingsOptions {
  uid: number;
  name: string;
  /** Verwalter, und ein App-Token hat die Freigabe schon (Route). */
  verwalter: boolean;
  /** Passwort und Faktor; sendet bei `false` die Absage selbst. */
  confirm: (passwort: string | null | undefined) => Promise<boolean>;
}

/** Ob ein Verwalter-Teil vorliegt: Nur dann braucht ein App-Token die Freigabe. */
export const hasGlobalValues = (e: SettingsInput) => GLOBAL_SETTINGS.some(k => e[k] !== undefined);

/** Mailserver, Registrierung und API-Schlüssel nur mit Passwort: Eine erbeutete
 * Verwaltersitzung läse sonst Rücksetz-Mails mit oder öffnete still die Registrierung.
 * Ein erster API-Schlüssel lenkt nichts um; nur der Einrichtungsassistent fragt dafür nicht nach. */
async function sensitiveKeys(k: ManagementContext, e: SettingsInput): Promise<string[]> {
  const sensitive: string[] = [];
  const einrichtung = !(await k.settings.globalValue('einrichtung_erledigt'));
  for (const key of GLOBAL_SETTINGS.filter(isSensitive)) {
    const neu = e[key];
    if (neu === undefined || (SECRET_KEYS.has(key) && isMasked(neu))) continue;
    const alt = String((await k.settings.globalValue(key)) ?? '');
    if (
      String(neu) === alt ||
      (einrichtung && alt === '' && !key.startsWith('smtp_') && key !== 'registration_enabled')
    )
      continue;
    sensitive.push(key);
  }
  return sensitive;
}

/** Eine unverändert zurückgeschickte Maske ist kein neuer Wert, sonst überschriebe
 * jedes Speichern die echten Schlüssel mit Punkten. */
async function writeGlobal(kx: ManagementContext, uid: number, e: SettingsInput): Promise<void> {
  const geaendert: string[] = [];
  for (const key of GLOBAL_SETTINGS) {
    if (e[key] === undefined || (SECRET_KEYS.has(key) && isMasked(e[key]))) continue;
    if (String(e[key]) !== String((await kx.settings.globalValue(key)) ?? '')) geaendert.push(key);
    await kx.settings.setGlobalValue(key, e[key]);
  }
  if (geaendert.length)
    await kx.account.verwalter.rememberAdminAction(uid, uid, 'einstellungen_geaendert', geaendert.join(', '));
  // Wer das Mailformular gespeichert hat, hat den Hinweis auf die alte Ausnahme gesehen.
  if (GLOBAL_SETTINGS.some(k => k.startsWith('smtp_') && e[k] !== undefined))
    await kx.settings.deleteGlobalValues('smtp_insecure_tls');
}

/** Alle Schreibvorgänge samt Protokoll in einer Transaktion: Scheitert ein Wert,
 * steht keiner der anderen halb gespeichert da. @returns false nach einer Absage */
export async function saveSettings(kx: ManagementContext, e: SettingsInput, o: SaveSettingsOptions): Promise<boolean> {
  const global = o.verwalter && hasGlobalValues(e);
  if (global) {
    if (GLOBAL_SETTINGS.some(k => e[k] !== undefined && !isValidGlobalValue(k, e[k])))
      fachfehler('ungueltig', 'wert_ungueltig');
    if (
      String(e.registration_enabled) === '1' &&
      (await kx.settings.globalValue('registration_enabled')) !== '1' &&
      !(await kx.mail.mailReady(e))
    )
      fachfehler('ungueltig', 'registrierung_braucht_mail');
  }
  const sensitive = global ? await sensitiveKeys(kx, e) : [];
  if (sensitive.length && !e.admin_password) fachfehler('ungueltig', 'aktuelles_passwort_erforderlich');
  if (sensitive.length && !(await o.confirm(e.admin_password))) return false;

  // Die Währung gilt für den ganzen Haushalt und braucht deshalb den Systemrahmen, der
  // sich in einer Transaktion nicht betreten lässt: vorher und für sich. Scheitert sie,
  // ist noch nichts geschrieben; der Preis-Job folgt nur einer echten Änderung.
  if (e.currency !== undefined) await kx.settings.setUserSetting(o.uid, 'currency', e.currency);
  // Globale Werte schreibt nur die Systemrolle (0117): dann die ganze Transaktion in ihrem Rahmen.
  const rahmen = <T>(f: () => Promise<T>) => (global ? inSystemContext('globale Einstellungen', f) : f());
  const bricksetAlt = await rahmen(() =>
    kx.transaktion(async t => {
      const alt =
        global && e.api_limit_brickset !== undefined
          ? parseInt((await t.settings.globalValue('api_limit_brickset')) || '100', 10)
          : null;
      if (global) await writeGlobal(t, o.uid, e);
      for (const key of ACCOUNT_SETTINGS)
        if (key !== 'currency' && e[key] !== undefined) await t.settings.setUserSetting(o.uid, key, e[key]);
      return alt;
    }),
  );
  if (!global) return true;
  // Erst nach dem COMMIT: Ein Zwischenspeicher läse vorher noch den alten Wert ein.
  await kx.settings.notifyGlobalChange();
  if (sensitive.some(k => !k.startsWith('smtp_')))
    kx.account.adminHintInBackground('einstellungen_geaendert', { konto: sensitive.join(', '), durch: o.name });
  if (bricksetAlt !== null) await bricksetLimitSet(kx, bricksetAlt, parseInt(String(e.api_limit_brickset), 10));
  return true;
}
