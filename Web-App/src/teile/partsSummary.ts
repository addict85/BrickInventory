/**
 * Vorberechnete Teile-Zusammenfassung.
 * Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#abschnitt
 */
import { meldeUndLiefere } from '../infra/httpError';
import { mengeJoin, mengeAus } from '../sets/bestandsmenge';
import { blJoin, blNummerSql } from '../katalog/blZuordnung';
import { teilmengeJoin, teilmengeAus } from '../sets/bestandsmenge';
import * as db from '../../db/database';
import * as lockNamespaces from '../infra/lockNamespaces';


/** Stand der Rohdaten dieses Kontos, und ob Katalogänderungen offen sind (Migration 0079). */
async function currentVersion(userId: number): Promise<{ v: number; katalogOffen: boolean }> {
  const r = await db.get(
    `SELECT (SELECT v FROM parts_version_user WHERE user_id = $1) AS v,
            EXISTS (SELECT 1 FROM parts_katalog_offen) AS katalog_offen`, [userId]);
  return { v: parseInt(r?.v) || 0, katalogOffen: !!r?.katalog_offen };
}

/**
 * Die Zeilen der Zusammenfassung eines Kontos ($1), wahlweise nur für die
 * Gruppen (BrickLink-Nummer) in $2 — dieselbe Abfrage für den vollen Aufbau
 * und das Nachziehen nach einer Katalogänderung.
 */
function zusammenfassungEinfuegen(nurGruppen: boolean): string {
  return `
      INSERT INTO parts_summary (user_id, part_key, color_id, part_number, bl_part_number,
        part_name, color_name, color_hex, category_name, image_url, image_local,
        is_spare, total_quantity, in_sets, storage)
      SELECT p.user_id,
             -- Gruppiert wird nach der BrickLink-Nummer, soweit eine abweicht.
             ${blNummerSql('p.part_number')},
             p.color_id,
             MIN(p.part_number), MIN(${blNummerSql('p.part_number')}),
             MIN(pc.part_name), MIN(pcc.color_name), MIN(pcc.color_hex), MIN(pc.category_name),
             MIN(pcc.image_url), MIN(pcc.image_local),
             -- Ersatzteil ist eine Angabe der Setliste; dasselbe Teil kann in
             -- einem Set Ersatz und im nächsten Pflicht sein.
             MAX(COALESCE(tm_k.is_spare, 0)),
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}),
             STRING_AGG(DISTINCT p.set_number, ','),
             -- Alle Lagerorte der Gruppe, nicht einer: Dasselbe Teil liegt aus
             -- mehreren Sets in verschiedenen Kisten.
             NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '')
        FROM parts p
        ${mengeJoin('p', 'sm', '= $1')}
        ${teilmengeJoin('p', 'part', 'tm', '= $1')}
        ${blJoin('p.part_number', 'part')}
        LEFT JOIN storage_locations lo ON lo.id = p.storage_id
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                        AND pcc.color_id    = p.color_id
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'${nurGruppen ? `
         AND ${blNummerSql('p.part_number')} = ANY($2)` : ''}
       GROUP BY p.user_id, ${blNummerSql('p.part_number')}, p.color_id`;
}

/** Baut die Zusammenfassung eines Nutzers neu auf. */
export async function rebuild(userId: number, version?: { v: number }): Promise<void> {
  const stand = version ?? await currentVersion(userId);
  // Ob DIESER Aufruf gebaut hat. Der Block unten verlaesst die Transaktion
  // vorzeitig, wenn ein anderer Arbeiter die Sperre haelt — dann hat hier
  // nichts geschrieben, und nachzupflegen waere 240 ms fuer nichts.
  let gebaut = false;
  await db.transaction(async (tx) => {
    // Sperre über die Datenbank, nicht nur über die In-Memory-Map
    // (_rebuilding) weiter unten.
    // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#rebuild-lock
    const lock = await tx.get('SELECT pg_try_advisory_xact_lock($1, $2) AS ok',
      [lockNamespaces.LOCKS.TEILE_SUMMARY, userId]);
    if (!lock?.ok) {
      // Ein anderer Worker baut gerade für denselben Nutzer — nichts tun,
      // dessen Ergebnis gilt gleich mit. Kein Fehler, kein Retry nötig.
      return;
    }

    await tx.run('DELETE FROM parts_summary WHERE user_id = $1', [userId]);
    await tx.run(zusammenfassungEinfuegen(false), [userId]);
    await tx.run(`
      INSERT INTO parts_summary_state (user_id, built_version, built_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, built_at = NOW()`,
      [userId, stand.v]);
    gebaut = true;
  });

  // Neuaufbau = Masseneinfügen: Ohne frische Statistik wählt der Planer den
  // falschen Index (db/tabellePflegen.ts). Höchstens alle zehn Minuten,
  // weil ANALYZE die Tabelle aller Konten vermisst. VACUUM entfällt, seit die
  // GIN-Indizes keine Warteliste führen (Migration 0054).
  if (gebaut && Date.now() - _letzteAnalyse > 10 * 60_000) {
    _letzteAnalyse = Date.now();
    await db.exec('ANALYZE parts_summary').catch((e: Error) => console.warn('[partsSummary] ANALYZE:', e.message));
  }
}

/**
 * Stellt sicher, dass die Zusammenfassung aktuell ist.
 * @returns true, wenn sie benutzbar ist
 */
let _letzteAnalyse = 0;

/** Laufende Neuaufbauten je Nutzer — verhindert Mehrfachläufe. */
const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(userId: number, v: { v: number }) {
  if (_rebuilding.has(userId)) return;
  const p = rebuild(userId, v)
    .catch(e => console.error('[partsSummary] Hintergrundaufbau:', e.message))
    .finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
}

/**
 * Ist die Zusammenfassung für diesen Nutzer benutzbar?
 * Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh
 */
export async function ensureFresh(userId: number | number[], opts?: { strict?: boolean }): Promise<boolean> {
  // Haushalt: je Konto prüfen, alle müssen mitspielen
  // Die Tabelle ist je Konto aufgebaut (Schlüssel user_id, part_key, color_id);
  // gelesen wird sie für den Haushalt mit user_id = ANY(...) und über part_key
  // verdichtet. Frisch ist die Sicht nur, wenn sie es für JEDES beteiligte …
  // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh-ids
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => ensureFresh(id, opts)));
    return results.every(Boolean);
  }
  // Ein Blickfeld mit genau einem Konto — der Fall darueber hat mehrere
  // bereits abgehandelt, eine leere Liste kann es nach `[userId]` nicht geben.
  userId = ids[0] ?? 0;
  try {
    const [v, state] = await Promise.all([
      currentVersion(userId as number),
      db.get('SELECT built_version FROM parts_summary_state WHERE user_id = $1', [userId]).catch(meldeUndLiefere('teile-zsf:get', null)),
    ]);
    // Offene Katalogänderungen zuerst nachziehen; hält ein anderer Prozess
    // die Sperre, ist der Stand in diesem Moment nicht gesichert.
    const katalogNachgezogen = !v.katalogOffen || (await katalogEinmalNachziehen()) !== null;
    if (state && parseInt(state.built_version) === v.v && katalogNachgezogen) return true;

    rebuildInBackground(userId, v);

    // strict: Nur ein AKTUELLER Stand zählt.
    // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh-2
    if (opts?.strict) return false;

    // Veraltete Zahlen sind besser als drei Sekunden Wartezeit; gibt es noch
    // gar keinen Stand, muss der Aufrufer live abfragen.
    return !!state;
  } catch (e: any) {
    // Schlägt etwas fehl, fällt der Aufrufer auf die Live-Abfrage zurück —
    // langsamer, aber nie falsch.
    console.error('[partsSummary]', e.message);
    return false;
  }
}

/** Ein Nachzug je Prozess: Die Konten eines Haushalts fragen gleichzeitig. */
let _nachzug: ReturnType<typeof zieheKatalogNach> | null = null;
function katalogEinmalNachziehen() {
  _nachzug ??= zieheKatalogNach().finally(() => { _nachzug = null; });
  return _nachzug;
}

/** Ab so vielen geänderten Nummern auf einmal (CSV-Katalogabgleich) baut jedes Konto neu. */
const KATALOG_EINZELN_BIS = 5000;

/**
 * Offene Katalogänderungen (Migration 0079) in die Zusammenfassungen ziehen:
 * je Konto nur die Gruppen, die eine geänderte Nummer enthalten — vorher wie
 * nachher, denn eine neue BrickLink-Zuordnung verschiebt ein Teil in eine
 * andere Gruppe. Konten ohne Zusammenfassung bleiben unberührt.
 * @returns null, wenn ein anderer Prozess gerade nachzieht
 */
export async function zieheKatalogNach(): Promise<{ konten: number; gruppen: number } | null> {
  return db.transaction(async (tx) => {
    const frei = await tx.get('SELECT pg_try_advisory_xact_lock($1, 0) AS ok', [lockNamespaces.LOCKS.TEILE_KATALOG]);
    if (!frei?.ok) return null;
    // DELETE … RETURNING nimmt nur, was schon festgeschrieben ist; was danach
    // eintrifft, bleibt für den nächsten Lauf stehen.
    const nummern = [...new Set((await tx.all<{ nummer: string }>('DELETE FROM parts_katalog_offen RETURNING nummer'))
      .map(r => r.nummer))];
    if (!nummern.length) return { konten: 0, gruppen: 0 };
    if (nummern.length > KATALOG_EINZELN_BIS) {
      const r = await tx.run('DELETE FROM parts_summary_state');
      return { konten: r?.changes ?? 0, gruppen: -1 };
    }
    const betroffen = await tx.all<{ user_id: number; part_key: string }>(`
      SELECT DISTINCT p.user_id, ${blNummerSql('p.part_number')} AS part_key
        FROM parts p
        ${blJoin('p.part_number', 'part')}
        JOIN parts_summary_state st ON st.user_id = p.user_id
       WHERE COALESCE(p.source, 'set') <> 'manual'
         AND (p.part_number = ANY($1) OR ${blNummerSql('p.part_number')} = ANY($1))
      UNION
      SELECT user_id, part_key FROM parts_summary WHERE part_key = ANY($1) OR part_number = ANY($1)`, [nummern]);
    const jeKonto = new Map<number, string[]>();
    for (const b of betroffen) jeKonto.set(b.user_id, [...(jeKonto.get(b.user_id) ?? []), b.part_key]);
    for (const [uid, gruppen] of jeKonto) {
      // Dieselbe Sperre wie rebuild(): Ein laufender Neuaufbau dieses Kontos
      // wird abgewartet, damit er nicht mit älterem Katalog überschreibt.
      await tx.get('SELECT pg_advisory_xact_lock($1, $2)', [lockNamespaces.LOCKS.TEILE_SUMMARY, uid]);
      await tx.run('DELETE FROM parts_summary WHERE user_id = $1 AND part_key = ANY($2)', [uid, gruppen]);
      await tx.run(zusammenfassungEinfuegen(true), [uid, gruppen]);
    }
    return { konten: jeKonto.size, gruppen: betroffen.length };
  });
}

/**
 * Erzwingt einen Neuaufbau und wartet darauf. Für Stellen, die anschliessend
 * garantiert aktuelle Zahlen brauchen (z. B. am Ende eines CSV-Imports).
 */
export async function rebuildNow(userId: number): Promise<void> {
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(userId);
  const p = rebuild(userId, v).finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
  return p;
}
