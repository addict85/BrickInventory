/** Sicherung der Einstellungen (JSON) und der Bestandsdaten (ZIP mit CSVs), dazu
 * das Einspielen einer Einstellungsdatei. Die Routen reichen nur durch. */
import type { Writable } from 'node:stream';
import { SECRET_KEYS, isMaskedValue, globalerWertGueltig } from '../einstellungen';
import { DAILY_JOBS } from '../auftraege';
import { zeitplanNeuPlanen } from './dienst';
import { jsonOderNull } from '../infra/validate';
import { fachfehler } from '../infra/fehlerTexte';
import { KonfigExport } from '../vertrag/einstellungen';
import type { VerwaltungKontext } from './kontext';

/** Mailserver, Registrierung und API-Schlüssel nimmt nur das Formular, mit Passwort. */
export const istHeikel = (k: string) =>
  k.startsWith('smtp_') || k === 'registration_enabled' || /api_key$|^bricklink_(consumer|token)/.test(k);

/** Globale Werte nur für Verwalter: Der Import nimmt sie nur von ihnen an, und
 * SMTP-Daten gehen ein Unterkonto nichts an. */
export async function konfigExport(k: VerwaltungKontext, uid: number, verwalter: boolean, name: string | null) {
  return {
    exported_at: new Date().toISOString(),
    exported_by: name,
    version: '3.0',
    global: verwalter ? await k.einstellungen.globaleWerteOhneGeheimnisse() : {},
    user_settings: await k.einstellungen.nutzerEinstellungen(uid),
  };
}

/** Alles im selben Archiv: Die Konfigurationsexporte können Bestandsdaten nicht tragen. */
export async function datenZip(
  k: VerwaltungKontext,
  uid: number,
  ziel: Writable,
  beiFehler: (e: Error) => void,
): Promise<void> {
  // archiver 8 ist ein ES-Modul; aus CommonJS geht nur require(), kein Import.
  const { ZipArchive } = require('archiver') as { ZipArchive: new (o: object) => ZipArchiv };
  const [setsCsv, partsCsv, figsCsv, merkCsv, alarmCsv] = await Promise.all([
    k.sets.buildSetsCsv(uid),
    k.bestand.buildPartsCsv(uid),
    k.bestand.buildFigsCsv(uid),
    k.merkliste.buildMerklisteCsv(uid),
    k.finanzen.preisalarm.buildPreisalarmeCsv(uid),
  ]);
  const archiv = new ZipArchive({ zlib: { level: 9 } });
  archiv.on('error', beiFehler);
  archiv.pipe(ziel);
  for (const [name, inhalt] of [
    ['sets.csv', setsCsv],
    ['teile.csv', partsCsv],
    ['minifiguren.csv', figsCsv],
    ['merkliste.csv', merkCsv],
    ['preisalarme.csv', alarmCsv],
  ] as const)
    archiv.append('﻿' + inhalt, { name });
  await archiv.finalize();
}
interface ZipArchiv {
  on(e: 'error', f: (e: Error) => void): void;
  pipe(z: Writable): void;
  append(inhalt: string, o: { name: string }): void;
  finalize(): Promise<void>;
}

const GLOBAL_IMPORT = [
  'bricklink_consumer_key',
  'bricklink_consumer_secret',
  'bricklink_token',
  'bricklink_token_secret',
  'brickset_api_key',
  'rebrickable_api_key',
  'price_job_interval_minutes',
  'price_cache_ttl',
  'api_limit_rebrickable',
  'api_limit_bricklink',
  'api_limit_brickset',
  'registration_enabled',
  'default_price_condition',
  'gutschein_land',
  ...DAILY_JOBS.map(j => `job_time_${j.name}`),
].filter(k => !istHeikel(k));
const KONTO_IMPORT = ['currency', 'user_default_condition'];

/** Eine Importdatei kommt von irgendwoher: Schema (KonfigExport), Regeln je Schlüssel
 * (GLOBALE_REGELN) und ohne die heiklen Schlüssel, die eine Bestätigung bräuchten. */
export async function konfigImport(kx: VerwaltungKontext, uid: number, verwalter: boolean, datei: Buffer) {
  const gelesen = jsonOderNull(datei.toString('utf-8'));
  const geprueft = gelesen ? KonfigExport.safeParse(gelesen.wert) : null;
  if (!geprueft?.success) fachfehler('ungueltig', 'json_ungueltig');
  const { global, user_settings: konto } = geprueft.data;
  let imported = 0;
  const smtpUebergangen = global ? Object.keys(global).filter(istHeikel) : [];
  if (global && verwalter) {
    if (GLOBAL_IMPORT.some(k => global[k] !== undefined && !globalerWertGueltig(k, global[k])))
      fachfehler('ungueltig', 'wert_ungueltig');
    const geaendert: string[] = [];
    for (const key of GLOBAL_IMPORT.filter(k => global[k] !== undefined)) {
      // Maskierte Werte aus älteren Exporten dürfen echte Schlüssel nicht überschreiben.
      if (SECRET_KEYS.has(key) && isMaskedValue(global[key])) continue;
      if (String(global[key]) !== String((await kx.einstellungen.getGlobalSetting(key)) ?? '')) geaendert.push(key);
      await kx.einstellungen.setGlobalSetting(key, global[key]);
      imported++;
    }
    if (geaendert.length)
      await kx.konto.protokoll.protokolliere(uid, uid, 'einstellungen_geaendert', `Import: ${geaendert.join(', ')}`);
  }
  // Zentrale Stelle: Eine importierte Währungsänderung stösst den Preis-Job an.
  for (const key of KONTO_IMPORT.filter(k => konto?.[k] !== undefined)) {
    await kx.konto.setUserSetting(uid, key, konto![key]);
    imported++;
  }
  // Nur Verwalter: Sonst könnte jedes Konto per Ein-Zeilen-Datei den Preis-Cache leeren.
  if (verwalter) await zeitplanNeuPlanen(kx);
  const note =
    (verwalter ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert') +
    (verwalter && smtpUebergangen.length
      ? '; Mailserver, Registrierung und API-Schlüssel nicht übernommen — bitte im Formular setzen'
      : '');
  return { imported, note, smtp_uebergangen: verwalter ? smtpUebergangen : [] };
}
