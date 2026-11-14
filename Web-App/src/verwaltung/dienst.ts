/** Fremde Dienste und Jobs erreicht die Überwachungsseite nur von hier aus,
 * damit die Routen keine Schichten überspringen. */
import fs from 'node:fs';
import { AbrufFehler } from '../infra/abruf';
import { naechsteUhrzeit, DAILY_JOBS } from '../auftraege';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, meldeFehler, ohneFehlendeDatei } from '../infra/fehler';
import { Abstriche, versuche } from '../infra/ergebnis';
import { anfragenJeMinute } from '../bilder';
import { alsAbrufFehler } from '../fremdquellen';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import type { VerwaltungKontext } from './kontext';

const QUELLEN: Record<string, (q: VerwaltungKontext['katalog']['quellen']) => Promise<void>> = {
  rebrickable: q => q.pruefeRebrickableZugang(),
  brickset: q => q.pruefeBricksetZugang(),
  bricklink: q => q.pruefeBricklinkZugang(),
};

const QUELLEN_NAME: Record<string, string> = {
  rebrickable: 'Rebrickable',
  brickset: 'Brickset',
  bricklink: 'BrickLink',
};

/** Der Assistent zeigt dem Verwalter, was zu tun ist; der rohe Text bleibt als `grund` für „Details“. */
function quellenAbsage(e: unknown): FehlerCode {
  const f = alsAbrufFehler(e),
    text = f.message;
  if (/nicht konfiguriert|nicht vollständig|not configured/i.test(text)) return 'quelle_ohne_schluessel';
  if (
    f.isTransient ||
    (e instanceof AbrufFehler && (e.grund === 'netz' || e.grund === 'zeitlimit')) ||
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text)
  )
    return 'quelle_nicht_erreichbar';
  if (/\b(401|403)\b|invalid|ungültig|unauthori[sz]ed/i.test(text)) return 'quelle_abgelehnt';
  return 'quelle_test_fehlgeschlagen';
}

/** null, wenn der Zugang antwortet; sonst Code, Name und roher Grund. Wirft nur bei unbekannter Quelle. */
export async function quellePruefen(
  k: VerwaltungKontext,
  quelle: string,
): Promise<{ code: FehlerCode; quelle: string; grund: string } | null> {
  const pruefe = Object.hasOwn(QUELLEN, quelle) ? QUELLEN[quelle] : undefined;
  if (!pruefe) fachfehler('ungueltig', 'quelle_unbekannt');
  try {
    await pruefe(k.katalog.quellen);
    return null;
  } catch (e) {
    return { code: quellenAbsage(e), quelle: QUELLEN_NAME[quelle] ?? quelle, grund: fehlertext(e).slice(0, 200) };
  }
}

export async function cacheStatistik(k: VerwaltungKontext) {
  const leer = { count: 0, limit: 0, remaining: 0 };
  const ab = new Abstriche();
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    ab.oder('cache', k.katalog.getCacheStats(), { prices: 0, subsets: 0, catalog: 0 }),
    ab.oder('veraltete_preise', k.verwaltung.veraltetePreise(), 0),
    ab.oder('kontingent_bricklink', k.katalog.getRateLimitStatus('bricklink'), leer),
    ab.oder('kontingent_rebrickable', k.katalog.getRateLimitStatus('rebrickable'), leer),
    ab.oder('kontingent_brickset', k.katalog.getRateLimitStatus('brickset'), leer),
  ]);
  return {
    ...stats,
    price_stale: stale,
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS },
    db_pool: k.db.getPoolStats(),
    ...ab.angabe(),
  };
}

export async function cachesLeeren(k: VerwaltungKontext, alle: boolean) {
  await k.finanzen.leerePreisCache();
  if (alle) {
    await k.katalog.clearSubsetsCache();
    await k.katalog.clearCatalogCache();
  }
}

/** Ist heute noch Kontingent da, gleich abarbeiten statt bis morgen zu warten. */
export async function bricksetLimitGesetzt(k: VerwaltungKontext, alt: number, neu: number) {
  if (!(neu > alt)) return;
  // Das neue Limit ist gespeichert; ohne Zählerstand wartet die Schlange auf den nächsten Lauf.
  const rl = await versuche('verwaltung:getRateLimitStatus', k.katalog.getRateLimitStatus('brickset'));
  if (!rl.ok) return;
  const rest = Math.max(0, neu - (rl.wert.count || 0));
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${neu}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  await k.auftraege.bricksetJetzt();
}

export async function anleitungenNeuEinreihen(k: VerwaltungKontext) {
  const fehlend = await k.verwaltung.setsOhneAnleitung();
  for (const { set_number } of fehlend) {
    await k.katalog.loescheAnleitungen(set_number);
    await k.auftraege.anleitungEinreihen(set_number);
  }
  return fehlend.length;
}

/** Im Format von früher, damit die Oberfläche unverändert bleibt. */
export async function preisJobStand(k: VerwaltungKontext) {
  const plan = await k.verwaltung.letzterLaufDerArt();
  let letzter: {
    lastRun?: string | null;
    lastDuration?: number | null;
    lastUpdated?: number;
    lastErrors?: number;
    log?: unknown;
  } = {};
  try {
    letzter = JSON.parse((await k.auftraege.liesZustand('preis_job_stand')) ?? '{}');
  } catch (e) {
    meldeFehler('verwaltung:preis-stand', e);
  }
  const laeuft = plan?.status === 'laeuft';
  const job = {
    running: laeuft,
    lastRun: letzter.lastRun ?? null,
    lastDuration: letzter.lastDuration ?? null,
    lastUpdated: letzter.lastUpdated ?? 0,
    lastErrors: letzter.lastErrors ?? 0,
    nextRun: plan && !laeuft ? new Date(plan.faellig_ab).toISOString() : null,
    progress:
      laeuft && plan?.fortschritt
        ? {
            current: plan.fortschritt.erledigt ?? 0,
            total: plan.fortschritt.gesamt ?? 0,
            set: plan.fortschritt.text ?? null,
          }
        : null,
    log: Array.isArray(letzter.log) ? letzter.log : [],
  };
  return { job, rate_limit: await k.katalog.getRateLimitStatus('bricklink') };
}

/** false, wenn er schon läuft. */
export const preisJobJetzt = (k: VerwaltungKontext) => k.auftraege.ziehePlanVor('preise');
/** Stellt nur den Auftrag ein; scheitert das, erfährt es der Verwalter statt des Protokolls. */
export async function fehlendeBilderNachladen(k: VerwaltungKontext): Promise<void> {
  await k.auftraege.stelleAuftragEin('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxVersuche: 2 });
}

export const katalogAbgleichJetzt = (k: VerwaltungKontext) => k.auftraege.ziehePlanVor('csv_sync');

/** Auch über das Tageskontingent hinweg. */
export async function bricksetWiederholen(k: VerwaltungKontext, sn: string) {
  await k.katalog.setzeKontingentZurueck('brickset');
  await k.auftraege.bricksetJetzt(sn);
}

export async function bricksetEntfernen(k: VerwaltungKontext, sn: string) {
  await k.katalog.quellen.ausRetryWarteschlange(sn);
  await k.auftraege.anleitungEinreihen(sn, { nurAusweichquelle: true });
}

/** Der offene geplante Auftrag bekommt sofort den neuen Termin. */
export async function jobZeitplanSetzen(k: VerwaltungKontext, name: unknown, time: unknown, minutes: unknown) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fachfehler('ungueltig', 'uhrzeit_ungueltig');
    await k.einstellungen.setGlobalSetting(
      `job_time_${daily.name}`,
      `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`,
    );
  } else if (name === 'priceJob') {
    await k.einstellungen.setGlobalSetting(
      'price_job_interval_minutes',
      String(Math.max(5, parseInt(String(minutes), 10) || 60)),
    );
  } else {
    fachfehler('ungueltig', 'unbekannter_job');
  }
  await zeitplanNeuPlanen(k);
}

export async function zeitplanNeuPlanen(k: VerwaltungKontext) {
  await k.auftraege.zeitplanGeaendert('csv_sync');
  await k.auftraege.zeitplanGeaendert('preise');
  const bis = naechsteUhrzeit(await k.auftraege.taeglicheUhrzeit('brickset_retry'));
  await k.auftraege.bricksetTermineVorziehen(bis);
}

/** Fertig ist ein Set mit Original UND Vorschau; zurückgenommene Fehlanzeigen
 * werden mitgezählt. */
export async function katalogBilderEinreihen(kx: VerwaltungKontext, alleErneut: boolean) {
  const zuVergessen = await (alleErneut ? kx.verwaltung.setFehlanzeigen() : kx.verwaltung.setFehlanzeigenOhne404());
  const verworfen = zuVergessen.length ? await kx.katalog.bilder.vergissFehlend(zuVergessen.map(r => r.cache_key)) : 0;
  // Was schon fertig ist, wird nicht wieder eingereiht.
  const vorhanden: Set<string> = new Set();
  try {
    const namen = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
    // Fehlt die Vorschau, bleibt das Set in der Warteschlange; der Job lädt dann
    // nicht erneut.
    for (const n of namen) {
      if (!n.endsWith('_thumb.jpg')) continue;
      const basis = n.slice(0, -'_thumb.jpg'.length);
      if (namen.has(`${basis}.jpg`)) vorhanden.add(basis);
    }
  } catch (e) {
    // Ohne Ordner ist noch nichts fertig; jeder andere Lesefehler kommt ins Protokoll.
    ohneFehlendeDatei('verwaltung:vorschauen lesen')(e);
  }

  const kandidaten = await kx.verwaltung.katalogBildKandidaten();

  // Dieselbe Namensregel wie setBildHerunterladen(), sonst fände der Vergleich nichts.
  const dateiname = (sn: string) => String(sn).replace(/[^a-z0-9-]/gi, '_');
  const offenSets: string[] = [];
  const offenUrls: string[] = [];
  for (const k of kandidaten) {
    if (vorhanden.has(dateiname(k.set_num))) continue;
    offenSets.push(k.set_num);
    offenUrls.push(k.set_img_url);
  }

  let neuEingereiht = 0;
  if (offenUrls.length) {
    neuEingereiht = await kx.katalog.bilder.katalogBilderVormerken(offenUrls, offenSets);
    await kx.katalog.bilder.bildbedarfAnstossen();
  }
  const offen = await kx.verwaltung.offeneBildauftraege();
  // „Stunden oder Tage?" ist die erste Frage; die Rate kommt aus dem Job selbst.
  const proMinute = anfragenJeMinute();
  return {
    queued: neuEingereiht,
    pending: offen?.n ?? 0,
    skipped: kandidaten.length - offenUrls.length,
    // Ohne die Zahl bliebe unklar, warum als fehlend geltende Bilder wieder anstehen.
    verworfen,
    dauer_minuten: Math.ceil((offen?.n ?? 0) / proMinute),
  };
}
/** Ohne Setliste nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen
 * anderen Zweck und verschwinden nur auf Wunsch (`vorschauen`). */
export async function bildFehlanzeigenVergessen(
  k: VerwaltungKontext,
  sets: string[] | null,
  vorschauen: boolean,
): Promise<number> {
  const v = k.verwaltung;
  const schluessel = sets?.length ? sets.map(sn => `set:${sn}`) : (await v.setFehlanzeigen()).map(r => r.cache_key);
  if (vorschauen) schluessel.push(...(await v.vorschauFehlanzeigen()).map(r => r.cache_key));
  return schluessel.length ? k.katalog.bilder.vergissFehlend(schluessel) : 0;
}

export function serverProtokollSeit(k: VerwaltungKontext, minuten: number) {
  return k.verwaltung.protokollSeit(minuten);
}

export { KontoBildzeile } from './repository/verwaltung';
