
import * as repo from './repository';
import { verschluessele, entschluessele, umschluesseln, kontext } from '../infra/geheimnis';
import { fachfehler, dateiFehler } from '../infra/fehlerTexte';
import { GLOBALE_REGELN, DESIGNS, type GlobalerSchluessel } from '../vertrag/globaleRegeln';

/** Gespeichert ist Text; mit Vorgabe ist das Ergebnis Text oder die Vorgabe, nie `any`. */
export async function getSetting(userId: number, key: string): Promise<string | null | undefined>;
export async function getSetting<T>(userId: number, key: string, fallback: T): Promise<string | T>;
export async function getSetting(userId: number, key: string, fallback?: unknown): Promise<unknown> {
  const eigen = await repo.nutzerWert(userId, key);
  if (eigen) return eigen;
  return klar(key, await repo.globalerWert(key)) || fallback;
}

/** Geheime Werte liegen verschlüsselt (src/infra/geheimnis.ts). */
function klar(key: string, wert: string | null | undefined): string | null | undefined {
  return SECRET_KEYS.has(key) ? entschluessele(wert, globalerKontext(key)) : wert;
}

/** Der Name im Kontext: Ein SMTP-Passwort, in die Zeile eines API-Schlüssels kopiert, bleibt unlesbar. */
const globalerKontext = (key: string) => kontext('global_settings.value', key);

export async function getGlobalSetting(key: string): Promise<string | null>;
export async function getGlobalSetting<T>(key: string, fallback: T): Promise<string | T>;
// Die Vorgabe gilt für „nicht gesetzt“, nicht für „nicht lesbar“: Sonst
// sähe ein Datenbankfehler aus wie ein fehlender Schlüssel oder eine Grundeinstellung.
export async function getGlobalSetting(key: string, fallback: unknown = null): Promise<unknown> {
  return klar(key, await repo.globalerWert(key)) ?? fallback;
}

// Was ein Konto selbst setzen darf: Die Werte landen in Seiten, PDFs und
// Preisabfragen; „XYZ" als Währung setzte jede Bewertung still auf null.
export const WAEHRUNGEN = new Set(['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK']);
export { DESIGNS };
const NUTZER_REGELN: Record<string, (v: string) => boolean> = {
  currency: v => WAEHRUNGEN.has(v),
  language: v => v === 'de' || v === 'en',
  user_default_condition: v => v === 'N' || v === 'U' || v === '',
  price_cache_ttl: v => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 8760,
  app_theme: v => DESIGNS.includes(v),
};

/** Prüfen und schreiben; die Währung gilt je Haushalt und geht deshalb nur
 * über setUserSetting (src/konto/nutzerEinstellung.ts). */
export async function schreibeNutzerEinstellung(userId: number, key: string, value: unknown): Promise<void> {
  const v = String(value).trim();
  if (key === 'currency') throw new Error('Währung nur über setUserSetting');
  const regel = NUTZER_REGELN[key];
  if (regel && !regel(v)) fachfehler('ungueltig', 'wert_ungueltig');
  await repo.schreibeNutzerWert(userId, key, v);
}

export function nutzerWertGueltig(key: string, value: string): boolean {
  return NUTZER_REGELN[key]?.(value) ?? true;
}

/** Eigener Wert → globaler Standard → 'N'; eine Stelle statt drei Fassungen.
 * Ausführlich: docs/begruendungen/src/einstellungen/settings.ts.md#nutzerstandardzustand */
export async function nutzerStandardZustand(userId: number): Promise<'N' | 'U'> {
  const eigen = await repo.nutzerWert(userId, 'user_default_condition');
  if (eigen === 'N' || eigen === 'U') return eigen;
  return globalDefaultCondition();
}

/** Eingabe → Bestand → Standard; eine Stelle, damit ein gebrauchtes Teil nie
 * den Neupreis bekommt.
 * @param eingabe Alles ausser 'N'/'U' zählt als nichts. */
export async function zustandFuerPreis(
  eingabe: unknown,
  bisher: string | null | undefined,
  userId: number,
): Promise<string> {
  if (eingabe === 'N' || eingabe === 'U') return eingabe;
  if (bisher) return bisher;
  return nutzerStandardZustand(userId);
}

export async function globalDefaultCondition(): Promise<'N' | 'U'> {
  const g = await repo.globalerWert('default_price_condition');
  return g === 'U' ? 'U' : 'N';
}

const regelFuer = (key: string) => Object.hasOwn(GLOBALE_REGELN, key) ? GLOBALE_REGELN[key as GlobalerSchluessel] : undefined;

export function globalerWertGueltig(key: string, value: unknown): boolean {
  return regelFuer(key)?.safeParse(value).success ?? false;
}

const _beiGlobalerAenderung: Array<() => void> = [];
/** Für Zwischenspeicher, die aus globalen Werten rechnen: Sie leeren sich selbst,
 * statt dass jede Schreibstelle sie kennen muss. */
export function beiGlobalerAenderung(fn: () => void): void {
  _beiGlobalerAenderung.push(fn);
}

/** Die EINE Schreibstelle; jeder Schlüssel braucht eine Regel in GLOBALE_REGELN.
 * Ausführlich: docs/begruendungen/src/einstellungen/settings.ts.md#setglobalsetting */
export async function setGlobalSetting(key: string, value: unknown) {
  const r = regelFuer(key)?.safeParse(value);
  if (!r?.success) throw (r?.error.issues[0] as { params?: { fehler?: unknown } } | undefined)?.params?.fehler ?? dateiFehler('ungueltig', 'wert_ungueltig');
  await repo.schreibeGlobalenWert(key, SECRET_KEYS.has(key) ? verschluessele(r.data, globalerKontext(key)) : r.data);
  for (const fn of _beiGlobalerAenderung) fn();
}

/** Offen nur bei genau '1'; fehlt die Zeile, bleibt sie zu. */
export async function registrierungOffen(): Promise<boolean> {
  return await getGlobalSetting('registration_enabled') === '1';
}

/** `AND value = $3`: Hat ein anderer Prozess die Zeile inzwischen neu
 * geschrieben, bleibt sie, wie sie ist. */
export async function verschluesseleGlobaleAltwerte(): Promise<number> {
  let n = 0;
  for (const z of await repo.globaleWerte([...SECRET_KEYS])) {
    const neu = umschluesseln(z.value, globalerKontext(z.key));
    if (neu && await repo.ersetzeGlobalenWert(z.key, z.value, neu)) n++;
  }
  return n;
}

/** „Fehlt" ist etwas anderes als „leer". */
export async function deleteGlobalSetting(...keys: string[]) {
  if (keys.length === 0) return;
  await repo.loescheGlobaleWerte(keys);
}

/** Danach gilt die Vorgabe der Installation. */
export async function deleteUserSetting(userId: number, key: string) {
  await repo.loescheNutzerWert(userId, key);
}

// Einstellungen LESEN — eine Fassung für beide Oberflächen, damit die Apps
// gleich funktionieren.

/** Werden nie im Klartext ausgeliefert. Ausführlich: docs/begruendungen/src/einstellungen/settings.ts.md#secret-keys */
export const SECRET_KEYS = new Set([
  'bricklink_consumer_key', 'bricklink_consumer_secret',
  'bricklink_token', 'bricklink_token_secret',
  'brickset_api_key', 'rebrickable_api_key',
  'smtp_pass',
]);

/** Kein Geheimnis, aber Sache des Verwalters: Mailserver und Konto verraten,
 * wohin die Rücksetz-Mails gehen. */
const NUR_VERWALTER = /^smtp_/;

/** Kommt in echten Schlüsseln nicht vor. */
const MASK_CHAR = '\u2022';

/** Kein einziges Zeichen des Werts geht mit: Schon die letzten vier verkürzen
 * das Raten und verraten, ob zwei Installationen denselben tragen. */
export function maskSecret(value: string | null | undefined) {
  return String(value ?? '') ? MASK_CHAR.repeat(12) : '';
}

export function isMaskedValue(value: unknown) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/** Nicht-Verwalter sehen die Schlüssel nicht, Verwalter maskiert. */
export function sanitizeGlobal(global: Record<string, unknown>, isAdmin: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(global)) {
    if (SECRET_KEYS.has(k)) {
      if (isAdmin) out[k] = maskSecret(v as string | null | undefined);
      continue;
    }
    if (!isAdmin && NUR_VERWALTER.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function nutzerEinstellungen(userId: number) {
  return Object.fromEntries((await repo.nutzerWerte(userId)).map(r => [r.key, r.value]));
}

export async function readSettings(userId: number, isAdmin: boolean) {
  const raw = Object.fromEntries((await repo.globaleWerte()).map(r => [r.key, klar(r.key, r.value)]));
  return { ...sanitizeGlobal(raw, !!isAdmin), ...await nutzerEinstellungen(userId) };
}

/** Ohne Geheimnisse: Die Datei wird weitergegeben; Schlüssel trägt man beim
 * Wiederherstellen neu ein. */
export async function globaleWerteOhneGeheimnisse(): Promise<Record<string, string>> {
  const aus: Record<string, string> = {};
  for (const r of await repo.globaleWerte())
    if (!SECRET_KEYS.has(r.key)) aus[r.key] = r.value;
  return aus;
}

// ── Design je Konto ─────────────────────────────────────────────────────────
// Ohne eigene Zeile gilt die Vorgabe des Verwalters — so folgen alle, die
// nichts gewählt haben, einem Wechsel.
export async function designFuer(userId?: number | null): Promise<{ theme: string; vorgabe: string; eigenes: string | null }> {
  const g = await getGlobalSetting('app_theme');
  const vorgabe = g && DESIGNS.includes(g) ? g : 'classic';
  const u = userId ? await repo.nutzerWert(userId, 'app_theme') : null;
  const eigenes = u && DESIGNS.includes(u) ? u : null;
  return { theme: eigenes ?? vorgabe, vorgabe, eigenes };
}
