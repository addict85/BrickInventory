/**
 * /api/v1 — Kaufpreis-Erfassungen (acquisitions) für Sets, manuelle Teile
 * und manuelle Minifiguren.
 *
 * Vorher existierte die PUT/DELETE-Logik dreimal fast identisch in
 * api_v1.ts — ein Bugfix (z. B. an der Latest-wins-Regel) musste dreimal
 * gepatcht werden. Jetzt beschreibt eine Config pro Ressource die
 * Unterschiede (Tabellen, Schlüsselspalten, Marktpreis-Fallback), die
 * Ablauflogik existiert genau einmal.
 *
 * Verbesserungen gegenüber der alten Implementierung:
 * - Parent-Mengen werden atomar per UPDATE … (SELECT SUM …) RETURNING
 *   berechnet statt Read-Modify-Write in JS (Race-frei, ein Roundtrip weniger).
 * - condition === null bedeutet "keine Änderung" statt Coercion auf 'N'
 *   (ältere Android-Clients serialisieren nicht gesetzte Felder als null —
 *   das setzte bei jeder Mengen-Änderung den Zustand auf "Neu" zurück).
 */
import express from 'express';
import * as db from '../../db/database';
import { writableIds } from '../../utils/household';
import { findSameDayAcquisition, acquisitionTotals } from '../../utils/acquisitions';
import { handleRouteError, fehlertext, pfadParam } from '../../utils/httpError';
import { withInventoryLock } from '../../utils/txLock';
import { requireToken } from './middleware';
import { acquisitionMoveSource, resolveWriteTarget, scopeIds, parseScopeMode } from '../../utils/household';
import { moveSetBetweenAccounts, moveManualAcquisition } from '../../utils/setMove';
import { getCurrentMarketPrice } from '../../utils/marketPrice';
import { deleteSetRows } from '../../utils/handlers/sets';
import { getPartAcquisitions } from '../parts';
import { getCurrentFigMarketPrice, getFigAcquisitions } from '../minifigs';
import { loescheManuellesTeil, loescheManuelleFigur } from '../../utils/handlers/shared';
import { SETS_PREIS_SQL, SETS_ZUSTAND_SQL } from '../../utils/setService';
const router = express.Router();

type AcqConfig = {
  /** Express-Pfad inkl. Ressourcen-Parametern, ohne die Erfassungs-ID. */
  routeBase: string;
  /** Name des ID-Parameters (':acqId' bei Sets — historisch — sonst ':id'). */
  idParam: string;
  table: string;
  /** Elementart für findSameDayAcquisition — 'set' | 'part' | 'fig'. */
  kind: 'set' | 'part' | 'fig';
  /** Preisspalte in der Erfassungstabelle UND Feldname im Request-Body. */
  priceCol: 'purchase_price' | 'unit_price';
  /** Schlüsselwerte der Ressource in fester Reihenfolge (ohne user_id). */
  keyVals: (req: any) => any[];
  /** Existenz-/Ownership-Check fürs PUT ($1=id, $2=uid, danach keyVals). */
  existsSql: string;
  existsWithKeys: boolean;
  notFound: string;
  /** 404 beim DELETE (Sets) oder stilles Löschen (Teile/Figuren, wie bisher). */
  deleteChecksExistence: boolean;
  /**
   * Marktpreis-Fallback, wenn der Preis geleert wird (null/'').
   * Sets haben keinen Fallback — leerer Preis bleibt leer.
   */
  resolvePrice: ((uid: any, keys: any[], cond?: string | null) => Promise<number | null>) | null;
  /** Atomare Neuberechnung der Parent-Menge ($1=uid, danach keyVals). */
  parentQuantitySql: string;
  /** Latest-wins-Preisübernahme in die Parent-Zeile ($1=Preis, $2=uid, danach keyVals). */
  parentPriceSql: string | null;
  /** Latest-wins-Zustandsübernahme in die Parent-Zeile ($1=Zustand, $2=uid, danach keyVals). */
  parentConditionSql: string;
  /** Neueste Erfassung der Ressource ($1=uid, danach keyVals). */
  latestSql: string;
  /**
   * Aufräumen, wenn nach dem Löschen KEINE Erfassung mehr übrig ist.
   *
   * ── Marcos Frage ──────────────────────────────────────────────────────────
   * „Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass der
   * Eintrag noch sichtbar war?"
   *
   * Ja, und zwar an mehreren Stellen. parentQuantitySql setzte die Menge auf 0
   * und liess die Elternzeile stehen. Nachgemessen mit einem einzelnen Konto
   * und zwei Sets, eines davon mit gelöschtem Kaufpreis:
   *
   *   Galerie      beide Sets, das leere mit „Menge 0"
   *   Statistik    Sets=2 (das leere zählte mit), Einheiten=1
   *   Bewertung    das leere Set mit ×1 bewertet — 20 CHF, die es nicht gibt
   *
   * Der letzte Punkt ist der schlimmste: `set.quantity || 1` in
   * utils/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen
   * NULL gedacht, trifft es hier den echten Wert 0 — und das Portfolio wuchs um
   * ein Set, das niemand mehr besitzt.
   *
   * Eine Menge von 0 ist auch kein Zustand, den jemand absichtlich herstellen
   * kann: Beide Mengenregler halten bei 1 (`min="1"` in der Webapp,
   * `if (qty > 1)` in der App). Sie entstand ausschliesslich hier. Deshalb wird
   * die Elternzeile jetzt entfernt, statt sie leer stehen zu lassen.
   */
  cleanupWhenEmpty: ((tx: any, ownerId: number, keys: any[]) => Promise<void>) | null;
};

function registerAcquisitionRoutes(cfg: AcqConfig) {
  const put = `${cfg.routeBase}/:${cfg.idParam}`;


/**
 * Antwort um das neu berechnete Zustands-Aggregat des Sets ergänzen.
 *
 * Ohne das mussten die Clients die Regel „eine U-Erfassung macht das Set
 * gebraucht" selbst nachbilden — die Webapp tat das falsch (sie nahm die
 * Bedingung der zuletzt erfassten Position), die Android-App gar nicht, weshalb
 * die Galerie-Kachel bis zum nächsten Listen-Reload das alte Label behielt.
 * Jetzt liefert der Server den Wert mit, und die Clients schreiben ihn nur noch
 * in ihre Liste.
 */
/**
 * Nach dem Nachführen der Menge: Ist nichts mehr da, die Elternzeile entfernen.
 *
 * Läuft in DERSELBEN Transaktion wie das Löschen der Erfassung — sonst gäbe es
 * einen Moment, in dem die Erfassung weg und die Zeile noch da ist, und bei
 * einem Abbruch bliebe genau der Geistereintrag zurück, den das hier
 * verhindern soll.
 */
async function raeumeLeerenBestand(tx: any, cfg: any, ownerId: number, keys: any[], row: any) {
  if (!cfg.cleanupWhenEmpty) return;
  if ((parseInt(String(row?.quantity ?? 0)) || 0) > 0) return;
  await cfg.cleanupWhenEmpty(tx, ownerId, keys);
}

async function withSetAggregate(uid: number, cfgTable: string, keys: any[], payload: any) {
  // Teile- und Minifiguren-Erfassungen haben kein Set-Aggregat.
  if (cfgTable !== 'set_acquisitions') return payload;
  const { withSetAggregate: attach } = require('../../utils/handlers/sets');
  return attach(uid, keys[0], payload);
}

  router.put(put, requireToken, async (req: AuthedRequest, res) => {
    try {
      const uid  = req.apiUser.user_id;
      const id   = parseInt(String(req.params[cfg.idParam]));
      const keys = cfg.keyVals(req);
      const { quantity, condition, date } = req.body;
      const rawPrice = req.body[cfg.priceCol];

      // ── Eigentümer wechseln ───────────────────────────────────────────────
      //
      // Verschoben wird über den KAUFPREIS — dieselbe Regel wie in den
      // Session-Routen (routes/sets.ts, routes/parts.ts, routes/minifigs.ts).
      // Der Zweig FEHLTE hier zunächst ganz: Die Android-App schickte
      // owner_user_id an genau diese PUT-Routen, die Fabrik las aber nur
      // Menge, Preis und Zustand — die Anfrage lief als leeres Update durch
      // und antwortete success:true, ohne dass irgendetwas wanderte.
      //
      // Absender aus der ZEILE, nicht aus dem Request (acquisitionMoveSource):
      // ein mitgeschickter from_user_id wird ignoriert. Läuft vor allen
      // anderen Feldern und beendet die Anfrage — Preis oder Datum derselben
      // Zeile im selben Aufruf zu ändern hiesse, sie zweimal zu suchen.
      const ownerReq = req.body?.owner_user_id;
      if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '') {
        const kind: 'set' | 'part' | 'fig' =
          cfg.table === 'set_acquisitions' ? 'set'
          : cfg.table === 'part_acquisitions' ? 'part' : 'fig';
        const from = await acquisitionMoveSource(uid, kind, id);
        const to   = await resolveWriteTarget(uid, ownerReq);
        if (to === null)
          return res.status(403).json({ success: false, error: 'Kein Schreibrecht für dieses Konto.' });
        if (from === to) return res.json({ success: true, unchanged: true });
        // Sperrschlüssel wie in der jeweiligen Session-Route, damit Webapp-
        // und App-Verschiebungen desselben Bestands aufeinander warten.
        const moved = kind === 'set'
          ? await withInventoryLock(from, keys[0], (tx) =>
              moveSetBetweenAccounts(tx, keys[0], from, to, [id]))
          : kind === 'part'
            ? await withInventoryLock(from, `${keys[0]}:${keys[1]}`, (tx) =>
                moveManualAcquisition(tx, 'part', keys, id, from, to))
            : await db.transaction(async (tx: any) =>
                moveManualAcquisition(tx, 'fig', keys, id, from, to));
        return res.json({ success: true, from_user_id: from, to_user_id: to, ...moved });
      }

      // Der Marktpreis-Rückfall (cfg.resolvePrice) ruft je nach Typ eine externe
      // API auf. Das MUSS vor der Transaktion passieren — ein Netzaufruf mit
      // offener Transaktion hielte Sperre und Verbindung sekundenlang.
      let priceVal: any;
      if (rawPrice !== undefined) {
        let p = (rawPrice === null || rawPrice === '') ? null : parseFloat(rawPrice);
        if ((p === null || isNaN(p)) && cfg.resolvePrice) {
          // Zustand der ZEILE mitgeben (Nachtrag 68): Ein „Neu"-Eintrag muss den
          // Neu-Preis bekommen, nicht den der Gebraucht-Erfassung daneben.
          // Steht im Rumpf ein neuer Zustand, gilt dieser; sonst der bisherige.
          const condRow = condition ? null
            : await db.get(`SELECT condition FROM ${cfg.table} WHERE id=$1`, [id]).catch(() => null);
          const cond = condition || condRow?.condition || null;
          p = await cfg.resolvePrice(uid, keys, cond).catch(() => null);
        }
        priceVal = (p !== null && !isNaN(p)) ? p : null;
      }

      // Prüfung und alle Schreibvorgänge samt Spiegelung in den Parent in EINER
      // Transaktion, serialisiert auf dem Bestandsschlüssel — siehe
      // utils/txLock.ts. Identisch zur Session-Variante in routes/sets.ts und
      // routes/parts.ts, damit Webapp und Android nicht auseinanderlaufen.
      await withInventoryLock(uid, `${cfg.table}:${keys.join(':')}`, async (tx) => {
        // SCHREIB-Blickfeld statt eigener ID (Nachtrag 45): Im Haushalt gehört
        // die Erfassung oft einem Unterkonto. Vorher lief die Suche stur gegen
        // user_id = eigene ID und lieferte 404 „Not found" — der Kaufpreis
        // liess sich schlicht nicht speichern. writableIds() ist bewusst enger
        // als scopeIds(): ein Unterkonto darf nicht rückwärts schreiben.
        const wids = await writableIds(uid);
        const acq = await tx.get(cfg.existsSql, cfg.existsWithKeys ? [id, wids, ...keys] : [id, wids]);
        if (!acq) { const e: any = new Error(cfg.notFound); e.status = 404; throw e; }
        // Ab hier zählt der BESITZER der Zeile, nicht der Betrachter — sonst
        // schriebe die Aktualisierung in die Daten des falschen Kontos.
        const ownerId = parseInt(String(acq.user_id));

        // Kaufdatum ändern — pro Tag, Element und Konto genau EIN Eintrag
        // (Nachtrag 70).
        //
        // Diese Fähigkeit hatten bisher NUR die Webapp-Routen. Beim
        // Zusammenlegen wäre sie fast verlorengegangen: Die Fabrik kannte das
        // Feld `date` gar nicht, und die App schickt es nicht — aufgefallen ist
        // es allein daran, dass ein bestehender Test den gemeinsamen Prüfer
        // verlangte. Genau dafür sind solche Tests da.
        //
        // Geprüft wird mit demselben Helfer wie beim Anlegen
        // (utils/acquisitions.ts), damit Anlegen und Bearbeiten nicht
        // auseinanderlaufen können.
        let _newDate: any = null;
        if (date !== undefined && date !== null && date !== '') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            const e: any = new Error('Ungültiges Datum'); e.status = 400; throw e;
          }
          const clash = await findSameDayAcquisition(cfg.kind, ownerId, keys, date, id, tx);
          if (clash) {
            const e: any = new Error('An diesem Datum existiert bereits ein Eintrag.');
            e.status = 409; throw e;
          }
          _newDate = date;
        }

        if (quantity !== undefined && quantity !== null) {
          const newQty = Math.max(1, parseInt(quantity) || 1);
          await tx.run(`UPDATE ${cfg.table} SET quantity=$1 WHERE id=$2`, [newQty, id]);
          const q = await tx.get(cfg.parentQuantitySql, [ownerId, ...keys]).catch(() => null);
          // Auch hier: Eine Erfassung auf 0 zu setzen ist zwar durch
          // Math.max(1, …) oben ausgeschlossen, aber die Regel gehört an die
          // Menge, nicht an den einen Weg dorthin.
          await raeumeLeerenBestand(tx, cfg, ownerId, keys, q);
        }

        if (rawPrice !== undefined) {
          await tx.run(`UPDATE ${cfg.table} SET ${cfg.priceCol}=$1 WHERE id=$2`, [priceVal, id]);
          if (cfg.parentPriceSql) {
            // Der Parent zeigt definitionsgemäss den Preis der NEUESTEN Erfassung
            const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
            if (latest?.id === id) await tx.run(cfg.parentPriceSql, [priceVal, ownerId, ...keys]);
          }
        }

        // null = keine Änderung (nicht auf 'N' zwingen — siehe Modul-Kommentar)
        if (condition !== undefined && condition !== null) {
          const cond = ['N', 'U'].includes(condition) ? condition : 'N';
          // Kein .catch(() => {}) mehr: Das war für Installationen ohne
          // condition-Spalte gedacht — die Spalte legt initSchema() inzwischen
          // garantiert an. In einer Transaktion ist ein verschluckter Fehler
          // besonders teuer, weil die folgenden Statements auf einer bereits
          // abgebrochenen Transaktion laufen.
          await tx.run(`UPDATE ${cfg.table} SET condition=$1 WHERE id=$2`, [cond, id]);
          const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
          if (latest?.id === id) await tx.run(cfg.parentConditionSql, [cond, ownerId, ...keys]);
        }

        if (_newDate) {
          await tx.run(`UPDATE ${cfg.table} SET created_at=$1::date + interval '12 hours' WHERE id=$2`,
            [_newDate, id]);
          // Nach einer Datumsänderung kann eine ANDERE Erfassung die neueste
          // sein — die Spiegelung in die Elternzeile muss deshalb neu bestimmt
          // werden, sonst zeigt die Kachel den Preis der falschen Zeile.
          const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
          if (latest && cfg.parentPriceSql) {
            const row = await tx.get(`SELECT ${cfg.priceCol} AS p, condition FROM ${cfg.table} WHERE id=$1`, [latest.id]);
            if (row) {
              await tx.run(cfg.parentPriceSql, [row.p, ownerId, ...keys]);
              if (cfg.parentConditionSql) await tx.run(cfg.parentConditionSql, [row.condition || 'N', ownerId, ...keys]);
            }
          }
        }
      });

      res.json(await withSetAggregate(uid, cfg.table, keys, { success: true }));
    } catch (e) { handleRouteError(res, e); }
  });

  router.delete(put, requireToken, async (req: AuthedRequest, res) => {
    try {
      const uid  = req.apiUser.user_id;
      const id   = parseInt(String(req.params[cfg.idParam]));
      const keys = cfg.keyVals(req);

      const row = await withInventoryLock(uid, `${cfg.table}:${keys.join(':')}`, async (tx) => {
        // Wie beim Aktualisieren (Nachtrag 45): über das SCHREIB-Blickfeld
        // suchen, danach mit dem BESITZER der Zeile weiterarbeiten. Vorher
        // konnte das Hauptkonto eine Erfassung des Unterkontos weder ändern
        // noch löschen — es bekam 404.
        const wids = await writableIds(uid);
        const acq = await tx.get(cfg.existsSql, cfg.existsWithKeys ? [id, wids, ...keys] : [id, wids]);
        if (cfg.deleteChecksExistence && !acq) {
          const e: any = new Error(cfg.notFound); e.status = 404; throw e;
        }
        const ownerId = acq ? parseInt(String(acq.user_id)) : uid;

        await tx.run(`DELETE FROM ${cfg.table} WHERE id=$1 AND user_id=$2`, [id, ownerId]);

        // Preis und Zustand der Elternzeile NEU bestimmen (Nachtrag 75,
        // Marcos Fund: „Kaufpreis entfernt, die Kachel zeigt ihn weiter").
        //
        // Der Lösch-Weg aktualisierte bisher NUR die Menge. Wer die neueste
        // Erfassung löschte, liess damit deren Preis in der Elternzeile stehen
        // — sichtbar in der Kachel oben, in der Galerie und in der
        // Finanzübersicht, die alle aus sets.purchase_price lesen. Auf Marcos
        // Screenshot: Erfassung 7.41, Kachel weiterhin 9.48 (der Preis der
        // gelöschten Zeile).
        //
        // Dieselbe Regel wie beim Ändern: Es gilt der Wert der jetzt NEUESTEN
        // verbliebenen Erfassung. Bleibt keine übrig, wird nichts überschrieben
        // — dann ist ohnehin der ganze Bestand weg.
        if (cfg.parentPriceSql || cfg.parentConditionSql) {
          const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
          if (latest) {
            const row = await tx.get(
              `SELECT ${cfg.priceCol} AS p, condition FROM ${cfg.table} WHERE id=$1`, [latest.id]);
            if (row) {
              if (cfg.parentPriceSql)     await tx.run(cfg.parentPriceSql, [row.p, ownerId, ...keys]);
              if (cfg.parentConditionSql) await tx.run(cfg.parentConditionSql, [row.condition || 'N', ownerId, ...keys]);
            }
          }
        }
        const row = await tx.get(cfg.parentQuantitySql, [ownerId, ...keys]).catch(() => null);
        await raeumeLeerenBestand(tx, cfg, ownerId, keys, row);
        return row;
      });
      res.json(await withSetAggregate(uid, cfg.table, keys, { success: true, new_quantity: row?.quantity ?? 0 }));
    } catch (e) { handleRouteError(res, e); }
  });
}

// ── SETS ──────────────────────────────────────────────────────────────────────
// GET /api/v1/sets/:setNumber/acquisitions — Kaufpreis-Historie eines Sets
router.get('/sets/:setNumber/acquisitions', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const sn  = req.params.setNumber;
  try {
    // Blickfeld wie in der Webapp-Route: Im Haushalt können die Kaufpreise
    // eines Sets mehreren Konten gehören, und je Zeile kommt der Eigentümer
    // mit. Der Paritätstest hält die beiden Antworten deckungsgleich.
    const ids = await scopeIds(uid, parseScopeMode(req.query.accounts));
    const rows = await db.all(
      `SELECT id, quantity, purchase_price,
              COALESCE(condition, 'N') AS condition,
              created_at, user_id AS owner_user_id FROM set_acquisitions
       WHERE user_id = ANY($1) AND set_number=$2 ORDER BY created_at ASC, id ASC`,
      [ids, sn]
    );
    // totals kommt vom Server (utils/acquisitions.ts) — die Summenzeile stand
    // sonst in jeder Oberfläche noch einmal.
    res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: uid });
  } catch (e) {
    console.error('[v1 acquisitions GET]', fehlertext(e));
    res.json({ success: true, acquisitions: [], totals: acquisitionTotals([]) }); // graceful fallback
  }
});

registerAcquisitionRoutes({
  routeBase: '/sets/:setNumber/acquisitions',
  idParam:   'acqId',
  table:     'set_acquisitions',
  kind:      'set',
  priceCol:  'purchase_price',
  keyVals:   req => [req.params.setNumber],
  existsSql: 'SELECT id, user_id FROM set_acquisitions WHERE id=$1 AND user_id = ANY($2) AND set_number=$3',
  existsWithKeys: true,
  notFound:  'Erfassung nicht gefunden',
  deleteChecksExistence: true,
  // Marktpreis nachfüllen, wenn das Feld geleert wird (Nachtrag 68, Marcos Fund:
  // „Kaufpreis löschen → wird nicht von BrickLink abgefüllt").
  //
  // Hier stand `null` — als EINZIGE der drei Elementarten. Teile und
  // Minifiguren holen den Marktpreis seit jeher, und die Webapp-Route tut es
  // für Sets ebenfalls. Nur der Android-Weg liess das Feld leer, und weil die
  // Kachel oben aus sets.purchase_price liest, stand dort danach ein Strich.
  // Wieder „dieselbe Regel fehlt am zweiten Weg".
  resolvePrice: (uid, [sn], cond) =>
    getCurrentMarketPrice(sn, uid, cond || null),
  parentQuantitySql: `UPDATE sets
     SET quantity = COALESCE((SELECT SUM(quantity) FROM set_acquisitions WHERE user_id=$1 AND set_number=$2), 0)
     WHERE user_id=$1 AND set_number=$2 RETURNING quantity`,
  // Kaufpreis in die sets-Zeile spiegeln (Nachtrag 51, Marcos Bericht:
  // „Der Preis oben in der Kachel wird nicht angepasst").
  //
  // Hier stand `null` — als EINZIGE der drei Elementarten. Teile und
  // Minifiguren spiegelten seit jeher, und die Webapp-Route tut es für Sets
  // auch (routes/sets.ts). Nur der Android-Weg liess die sets-Zeile stehen:
  // Die Erfassung stand danach auf 107, die Kachel weiter auf 108, und weil
  // Galerie, Finanzübersicht und Detail-Kachel alle aus sets.purchase_price
  // lesen, zeigte die ganze App den alten Wert — dauerhaft, nicht nur bis zum
  // Neuladen. Am laufenden Server nachgestellt: derselbe Preiswechsel über
  // beide Wege, Webapp zog die Kachel mit, Android nicht.
  //
  // Wieder das Muster „dieselbe Regel fehlt am zweiten Weg". Die Bedingung
  // („nur wenn die geänderte Erfassung die neueste ist") steckt bereits im
  // gemeinsamen Ablauf oben und gilt damit automatisch mit.
  parentPriceSql: SETS_PREIS_SQL,
  parentConditionSql: SETS_ZUSTAND_SQL,
  latestSql: 'SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC LIMIT 1',
  // Dieselben Zeilen wie beim ausdrücklichen Löschen — EINE Liste, in
  // utils/handlers.ts. Ohne die Teile und Minifiguren blieben sie ohne Set
  // zurück und tauchten in Teileliste und Finanzsummen weiter auf.
  cleanupWhenEmpty: async (tx, ownerId, [sn]) => {
    await deleteSetRows(tx, [ownerId], sn);
  },
});

// ── MANUELLE TEILE ────────────────────────────────────────────────────────────
router.get('/parts/:partNumber/:colorId/acquisitions', requireToken, async (req: AuthedRequest, res) => {
  try {
    const rows = await getPartAcquisitions(
      await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
      pfadParam(req, 'partNumber'), pfadParam(req, 'colorId'));
    res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: req.apiUser.user_id });
  } catch (e) { handleRouteError(res, e); }
});

registerAcquisitionRoutes({
  routeBase: '/parts/:partNumber/:colorId/acquisitions',
  idParam:   'id',
  table:     'part_acquisitions',
  kind:      'part',
  priceCol:  'unit_price',
  keyVals:   req => [req.params.partNumber, parseInt(req.params.colorId) || 0],
  existsSql: 'SELECT id, user_id FROM part_acquisitions WHERE id=$1 AND user_id = ANY($2)',
  existsWithKeys: false,
  notFound:  'Not found',
  deleteChecksExistence: false,
  // ── cond MITGEBEN (Nachtrag 146) ──────────────────────────────────────────
  //
  // Der Aufrufer reicht den Zustand DIESER Zeile durch (siehe oben, Nachtrag
  // 68). Die Sets-Fassung nimmt ihn seit jeher; Teile und Minifiguren liessen
  // ihn fallen und leiteten stattdessen einen Zustand aus ALLEN Erfassungen
  // des Eintrags ab.
  //
  // Marcos Befund: „Wenn ich bei der Minifigur einen zweiten Preis mit anderem
  // Zustand erfasse, wird der Marktpreis dieses Zustands nicht angezeigt. Der
  // Preis ist ebenfalls identisch, wenn ich das Feld leer lasse."
  //
  // Genau das: Eine Gebraucht-Zeile bekam den Preis, der aus dem
  // Sammelzustand des Eintrags fiel — und ein Marktpreis für „Gebraucht"
  // wurde nie ermittelt, also blieb die Zeile im Detailfenster leer.
  resolvePrice: (uid, [pn, cid], cond) =>
    require('../parts').getCurrentPartMarketPrice(pn, cid, uid, cond),
  parentQuantitySql: `UPDATE parts
     SET quantity = COALESCE((SELECT SUM(quantity) FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3), 0)
     WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual' RETURNING quantity`,
  parentPriceSql: `UPDATE parts SET unit_price=$1, purchase_price=$1
     WHERE user_id=$2 AND part_number=$3 AND color_id=$4 AND source='manual'`,
  parentConditionSql: `UPDATE parts SET condition=$1
     WHERE user_id=$2 AND part_number=$3 AND color_id=$4 AND source='manual'`,
  latestSql: 'SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3 ORDER BY created_at DESC, id DESC LIMIT 1',
  // Nur die manuelle Position: Teile aus einem Set hängen am Set und werden
  // mit ihm gelöscht, nicht hier.
  cleanupWhenEmpty: async (tx, ownerId, [pn, cid]) => {
    await loescheManuellesTeil(tx, ownerId, pn, cid);
  },
});

// ── MANUELLE MINIFIGUREN ──────────────────────────────────────────────────────
router.get('/minifigs/:figNumber/acquisitions', requireToken, async (req: AuthedRequest, res) => {
  try {
    const rows = await getFigAcquisitions(
      await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), pfadParam(req, 'figNumber'));
    res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: req.apiUser.user_id });
  } catch (e) { handleRouteError(res, e); }
});

registerAcquisitionRoutes({
  routeBase: '/minifigs/:figNumber/acquisitions',
  idParam:   'id',
  table:     'minifig_acquisitions',
  kind:      'fig',
  priceCol:  'unit_price',
  keyVals:   req => [req.params.figNumber],
  existsSql: 'SELECT id, user_id FROM minifig_acquisitions WHERE id=$1 AND user_id = ANY($2)',
  existsWithKeys: false,
  notFound:  'Not found',
  deleteChecksExistence: false,
  // cond mitgeben — siehe die Begründung bei den Teilen (Nachtrag 146).
  resolvePrice: async (uid, [fn], cond) => {
    const figRow = await db.get(
      "SELECT bl_fig_number FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
      [uid, fn]
    ).catch(() => null);
    return getCurrentFigMarketPrice(fn, uid, figRow?.bl_fig_number || null, cond);
  },
  parentQuantitySql: `UPDATE minifigs
     SET quantity = COALESCE((SELECT SUM(quantity) FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2), 0)
     WHERE user_id=$1 AND fig_number=$2 AND source='manual' RETURNING quantity`,
  parentPriceSql: `UPDATE minifigs SET unit_price=$1, purchase_price=$1
     WHERE user_id=$2 AND fig_number=$3 AND source='manual'`,
  parentConditionSql: `UPDATE minifigs SET condition=$1
     WHERE user_id=$2 AND fig_number=$3 AND source='manual'`,
  latestSql: 'SELECT id FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2 ORDER BY created_at DESC, id DESC LIMIT 1',
  // Nur die manuelle Position — siehe Teile.
  cleanupWhenEmpty: async (tx, ownerId, [fn]) => {
    await loescheManuelleFigur(tx, ownerId, fn);
  },
});

export default router;
