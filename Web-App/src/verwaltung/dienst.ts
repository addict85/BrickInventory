/** Fremde Dienste und Jobs erreicht die Überwachungsseite nur von hier aus,
 * damit die Routen keine Schichten überspringen. */
import fs from 'node:fs';
import { AbrufFehler } from '../infra/abruf';
import { auftraegeBereich, naechsteUhrzeit, taeglicheUhrzeit, DAILY_JOBS, ziehePlanVor, zeitplanGeaendert, stelleAuftragEin, anleitungEinreihen, bricksetJetzt, bricksetTermineVorziehen } from '../auftraege';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, meldeFehler, logAndContinue, ohneFehlendeDatei } from '../infra/fehler';
import { Abstriche, versuche } from '../infra/ergebnis';
import { leerePreisCache } from '../finanzen';
import { getRateLimitStatus, setzeKontingentZurueck, clearCatalogCache, clearSubsetsCache, getCacheStats, loescheAnleitungen, vergissFehlend, anfragenJeMinute, bildbedarfAnstossen, katalogBilderVormerken, alsAbrufFehler, pruefeBricklinkZugang, ausRetryWarteschlange, pruefeBricksetZugang, pruefeRebrickableZugang } from '../katalog';
import { setGlobalSetting } from '../einstellungen';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import { verwaltungBereich } from './prozess';

const QUELLEN: Record<string, () => Promise<void>> = {
  rebrickable: pruefeRebrickableZugang,
  brickset: pruefeBricksetZugang,
  bricklink: pruefeBricklinkZugang,
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
  quelle: string,
): Promise<{ code: FehlerCode; quelle: string; grund: string } | null> {
  const pruefe = Object.hasOwn(QUELLEN, quelle) ? QUELLEN[quelle] : undefined;
  if (!pruefe) fachfehler('ungueltig', 'quelle_unbekannt');
  try {
    await pruefe();
    return null;
  } catch (e) {
    return { code: quellenAbsage(e), quelle: QUELLEN_NAME[quelle] ?? quelle, grund: fehlertext(e).slice(0, 200) };
  }
}

export async function cacheStatistik() {
  const leer = { count: 0, limit: 0, remaining: 0 };
  const ab = new Abstriche();
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    ab.oder('cache', getCacheStats(), { prices: 0, subsets: 0, catalog: 0 }),
    ab.oder('veraltete_preise', verwaltungBereich().verwaltung.veraltetePreise(), 0),
    ab.oder('kontingent_bricklink', getRateLimitStatus('bricklink'), leer),
    ab.oder('kontingent_rebrickable', getRateLimitStatus('rebrickable'), leer),
    ab.oder('kontingent_brickset', getRateLimitStatus('brickset'), leer),
  ]);
  return {
    ...stats,
    price_stale: stale,
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS },
    db_pool: verwaltungBereich().db.getPoolStats(),
    ...ab.angabe(),
  };
}

export async function cachesLeeren(alle: boolean) {
  await leerePreisCache();
  if (alle) {
    await clearSubsetsCache();
    await clearCatalogCache();
  }
}

/** Ist heute noch Kontingent da, gleich abarbeiten statt bis morgen zu warten. */
export async function bricksetLimitGesetzt(alt: number, neu: number) {
  if (!(neu > alt)) return;
  // Das neue Limit ist gespeichert; ohne Zählerstand wartet die Schlange auf den nächsten Lauf.
  const rl = await versuche('verwaltung:getRateLimitStatus', getRateLimitStatus('brickset'));
  if (!rl.ok) return;
  const rest = Math.max(0, neu - (rl.wert.count || 0));
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${neu}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  await bricksetJetzt();
}

export async function anleitungenNeuEinreihen() {
  const fehlend = await verwaltungBereich().verwaltung.setsOhneAnleitung();
  for (const { set_number } of fehlend) {
    await loescheAnleitungen(set_number).catch(logAndContinue('verwaltung:loescheAnleitungen'));
    await anleitungEinreihen(set_number);
  }
  return fehlend.length;
}

/** Im Format von früher, damit die Oberfläche unverändert bleibt. */
export async function preisJobStand() {
  const plan = await verwaltungBereich().verwaltung.letzterLaufDerArt();
  let letzter: Record<string, any> = {};
  try {
    letzter = JSON.parse((await auftraegeBereich().laufzustand.liesZustand('preis_job_stand')) ?? '{}');
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
  return { job, rate_limit: await getRateLimitStatus('bricklink') };
}

/** false, wenn er schon läuft. */
export const preisJobJetzt = () => ziehePlanVor('preise');
export const fehlendeBilderNachladen = () => {
  void stelleAuftragEin('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxVersuche: 2 }).catch(
    logAndContinue('verwaltung:bilder nachladen'),
  );
};

export const katalogAbgleichJetzt = () => ziehePlanVor('csv_sync');

export { bricksetListe } from '../auftraege';

/** Auch über das Tageskontingent hinweg. */
export async function bricksetWiederholen(sn: string) {
  await setzeKontingentZurueck('brickset').catch(logAndContinue('brickset:kontingent zurücksetzen'));
  await bricksetJetzt(sn);
}

export async function bricksetEntfernen(sn: string) {
  await ausRetryWarteschlange(sn).catch(logAndContinue('verwaltung:ausRetryWarteschlange'));
  await anleitungEinreihen(sn, { nurAusweichquelle: true });
}

/** Der offene geplante Auftrag bekommt sofort den neuen Termin. */
export async function jobZeitplanSetzen(name: unknown, time: unknown, minutes: unknown) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fachfehler('ungueltig', 'uhrzeit_ungueltig');
    await setGlobalSetting(
      `job_time_${daily.name}`,
      `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`,
    );
  } else if (name === 'priceJob') {
    await setGlobalSetting('price_job_interval_minutes', String(Math.max(5, parseInt(String(minutes)) || 60)));
  } else {
    fachfehler('ungueltig', 'unbekannter_job');
  }
  await zeitplanNeuPlanen();
}

export async function zeitplanNeuPlanen() {
  await zeitplanGeaendert('csv_sync');
  await zeitplanGeaendert('preise');
  const bis = naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
  await bricksetTermineVorziehen(bis);
}

/** Fertig ist ein Set mit Original UND Vorschau; zurückgenommene Fehlanzeigen
 * werden mitgezählt. */
export async function katalogBilderEinreihen(alleErneut: boolean) {
  const zuVergessen = await (alleErneut ? verwaltungBereich().verwaltung.setFehlanzeigen() : verwaltungBereich().verwaltung.setFehlanzeigenOhne404());
  const verworfen = zuVergessen.length ? await vergissFehlend(zuVergessen.map(r => r.cache_key)) : 0;
  // Was schon fertig ist, wird nicht wieder eingereiht.
  let vorhanden: Set<string> = new Set();
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

  const kandidaten = await verwaltungBereich().verwaltung.katalogBildKandidaten();

  // Dieselbe Namensregel wie downloadSetImage(), sonst fände der Vergleich nichts.
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
    neuEingereiht = await katalogBilderVormerken(offenUrls, offenSets);
    await bildbedarfAnstossen();
  }
  const offen = await verwaltungBereich().verwaltung.offeneBildauftraege();
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
export { KontoBildzeile } from './repository/verwaltung';
