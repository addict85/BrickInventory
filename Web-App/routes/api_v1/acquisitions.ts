/**
 * /api/v1 — Kaufpreis-Erfassungen (acquisitions) für Sets, manuelle Teile
 * und manuelle Minifiguren.
 * Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#abschnitt
 */
import express from 'express';
import * as db from '../../db/database';
import { writableIds } from '../../utils/household';
import { findSameDayAcquisition, acquisitionTotals } from '../../utils/acquisitions';
import { handleRouteError, fehlertext, pfadParam } from '../../utils/httpError';
import { withInventoryLock, bestandsSchluessel } from '../../utils/txLock';
import { requireToken } from './middleware';
import { acquisitionMoveSource, resolveWriteTarget, scopeIds, parseScopeMode } from '../../utils/household';
import { moveSetBetweenAccounts, moveManualAcquisition } from '../../utils/setMove';
import { getCurrentMarketPrice } from '../../utils/marketPrice';
import { deleteSetRows } from '../../utils/handlers/sets';
import { getPartAcquisitions } from '../parts';
import { getCurrentFigMarketPrice, getFigAcquisitions } from '../minifigs';
import { loescheManuellesTeil, loescheManuelleFigur } from '../../utils/handlers/shared';
import { sendeFehler, fehlerWerfen } from '../../utils/fehlerTexte';
import type { FehlerCode } from '../../utils/fehlerTexte';
import { blAbrufNummer } from '../../utils/blZuordnung';
import { mengeDesSets, mengeDerPosition } from '../../utils/bestandsmenge';
import { bestandsMenge } from '../../utils/validate';
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
  /** Der GRUND als Code, nicht als Satz — siehe utils/fehlerTexte.ts. */
  notFound: FehlerCode;
  /** 404 beim DELETE (Sets) oder stilles Löschen (Teile/Figuren, wie bisher). */
  deleteChecksExistence: boolean;
  /**
   * Marktpreis-Fallback, wenn der Preis geleert wird (null/'').
   * Sets haben keinen Fallback — leerer Preis bleibt leer.
   */
  resolvePrice: ((uid: any, keys: any[], cond?: string | null) => Promise<number | null>) | null;
  // parentQuantitySql stand hier: je Elementart eine eigene Anweisung fuer
  // dieselbe Rechnung. Sie steht jetzt EINMAL in utils/bestandsmenge.ts, und
  // `kind` oben sagt bereits, welche Tabelle gemeint ist — eine zweite Angabe
  // koennte nur noch widersprechen.
  /** Latest-wins-Preisübernahme in die Parent-Zeile ($1=Preis, $2=uid, danach keyVals). */
  parentPriceSql: string | null;
  /**
   * Latest-wins-Zustandsübernahme in die Parent-Zeile ($1=Zustand, $2=uid,
   * danach keyVals). null für Sets: Dort gibt es seit Migration 0032 keine
   * Spalte mehr, in die gespiegelt werden könnte.
   */
  parentConditionSql: string | null;
  /** Neueste Erfassung der Ressource ($1=uid, danach keyVals). */
  latestSql: string;
  /**
   * Aufräumen, wenn nach dem Löschen KEINE Erfassung mehr übrig ist.
   * Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#acqconfig
   */
  cleanupWhenEmpty: ((tx: any, ownerId: number, keys: any[]) => Promise<void>) | null;
};

/** Besitzer einer Erfassung für den Sperrschlüssel; die Rechte prüft danach die Route. */
async function besitzerDerZeile(table: string, id: number, fallback: number): Promise<number> {
  const r = await db.get(`SELECT user_id FROM ${table} WHERE id = $1`, [id]);
  return r ? parseInt(String(r.user_id)) : fallback;
}

function registerAcquisitionRoutes(cfg: AcqConfig) {
  const put = `${cfg.routeBase}/:${cfg.idParam}`;


/**
 * Antwort um das neu berechnete Zustands-Aggregat des Sets ergänzen.
 * Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#abschnitt-2
 */
/**
 * Nach dem Nachführen der Menge: Ist nichts mehr da, die Elternzeile entfernen.
 *
 * Läuft in DERSELBEN Transaktion wie das Löschen der Erfassung — sonst gäbe es
 * einen Moment, in dem die Erfassung weg und die Zeile noch da ist, und bei
 * einem Abbruch bliebe genau der Geistereintrag zurück, den das hier
 * verhindern soll.
 */
async function raeumeLeerenBestand(tx: any, cfg: any, ownerId: number, keys: any[], menge: number | null) {
  if (!cfg.cleanupWhenEmpty) return;
  if ((menge ?? 0) > 0) return;
  await cfg.cleanupWhenEmpty(tx, ownerId, keys);
}

/**
 * Die Stueckzahl der Bestandszeile aus den Erfassungen — und zwar ueber
 * utils/bestandsmenge.ts, die einzige Stelle, die sie schreibt.
 * Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#mengedesbestands
 */
async function mengeDesBestands(tx: any, cfg: any, ownerId: number, keys: any[]) {
  // Beide Wege LESEN nur — der Zwischenstand, in dem die Teile- und
  // Figurenspalte noch geschrieben werden musste, ist mit Migration 0038
  // vorbei. Beide liefern dieselben drei Antworten: eine Zahl, 0 („Zeile da,
  // nichts drin" → aufraeumen) oder null („Zeile gibt es nicht").
  return cfg.kind === 'set'
    ? mengeDesSets(ownerId, String(keys[0]), tx).catch(() => null)
    : mengeDerPosition(cfg.kind, ownerId, keys, tx).catch(() => null);
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

      // Eigentümer wechseln
      // Verschoben wird über den KAUFPREIS — dieselbe Regel wie in den
      // Session-Routen (routes/sets.ts, routes/parts.ts, routes/minifigs.ts).
      // Der Zweig FEHLTE hier zunächst ganz: Die Android-App schickte …
      // Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#withsetaggregate-ownerreq
      const ownerReq = req.body?.owner_user_id;
      if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '') {
        const kind: 'set' | 'part' | 'fig' =
          cfg.table === 'set_acquisitions' ? 'set'
          : cfg.table === 'part_acquisitions' ? 'part' : 'fig';
        const from = await acquisitionMoveSource(uid, kind, id);
        const to   = await resolveWriteTarget(uid, ownerReq);
        if (to === null)
          return sendeFehler(req, res, 403, 'kein_schreibrecht');
        if (from === to) return res.json({ success: true, unchanged: true });
        // Sperrschlüssel wie in der jeweiligen Session-Route, damit Webapp-
        // und App-Verschiebungen desselben Bestands aufeinander warten.
        const moved = await withInventoryLock(from, bestandsSchluessel(kind, keys), (tx) =>
          kind === 'set'
            ? moveSetBetweenAccounts(tx, keys[0], from, to, [id])
            : moveManualAcquisition(tx, kind, keys, id, from, to));
        return res.json({ success: true, from_user_id: from, to_user_id: to, ...moved });
      }

      // Der Marktpreis-Rückfall (cfg.resolvePrice) ruft je nach Typ eine externe
      // API auf. Das MUSS vor der Transaktion passieren — ein Netzaufruf mit
      // offener Transaktion hielte Sperre und Verbindung sekundenlang.
      let priceVal: any;
      // Ein geleerter Preis wird durch den Marktpreis ersetzt — dann ist er geschätzt.
      let preisGeschaetzt = false;
      if (rawPrice !== undefined) {
        let p = (rawPrice === null || rawPrice === '') ? null : parseFloat(rawPrice);
        if ((p === null || isNaN(p)) && cfg.resolvePrice) {
          preisGeschaetzt = true;
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
      const besitzer = await besitzerDerZeile(cfg.table, id, uid);
      await withInventoryLock(besitzer, bestandsSchluessel(cfg.kind, keys), async (tx) => {
        // SCHREIB-Blickfeld statt eigener ID (Nachtrag 45): Im Haushalt gehört
        // die Erfassung oft einem Unterkonto. Vorher lief die Suche stur gegen
        // user_id = eigene ID und lieferte 404 „Not found" — der Kaufpreis
        // liess sich schlicht nicht speichern. writableIds() ist bewusst enger
        // als scopeIds(): ein Unterkonto darf nicht rückwärts schreiben.
        const wids = await writableIds(uid);
        const acq = await tx.get(cfg.existsSql, cfg.existsWithKeys ? [id, wids, ...keys] : [id, wids]);
        if (!acq) fehlerWerfen(cfg.notFound, 404);
        // Ab hier zählt der BESITZER der Zeile, nicht der Betrachter — sonst
        // schriebe die Aktualisierung in die Daten des falschen Kontos.
        const ownerId = parseInt(String(acq.user_id));

        let _newDate: any = null;
        if (date !== undefined && date !== null && date !== '') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            fehlerWerfen('datum_ungueltig', 400);
          }
          _newDate = date;
        }
        // Eine Zeile je Tag, Zustand, Preis, Herkunft und Währung: Geprüft
        // wird gegen die Werte, die die Zeile NACH dieser Änderung hat.
        const zielZustand = (condition !== undefined && condition !== null)
          ? (['N', 'U'].includes(condition) ? condition : 'N')
          : (acq.condition || 'N');
        const zielGeschaetzt = rawPrice !== undefined ? (preisGeschaetzt && priceVal != null) : !!acq.price_estimated;
        if (_newDate || rawPrice !== undefined || (condition !== undefined && condition !== null)) {
          const clash = await findSameDayAcquisition(
            cfg.kind, ownerId, keys, _newDate || acq.tag, id, zielZustand, tx,
            { preis: rawPrice !== undefined ? priceVal : acq.preis, geschaetzt: zielGeschaetzt, waehrung: acq.currency });
          if (clash) {
            fehlerWerfen('datum_belegt', 409);
          }
        }

        if (quantity !== undefined && quantity !== null) {
          const newQty = bestandsMenge(quantity, 1);
          await tx.run(`UPDATE ${cfg.table} SET quantity=$1 WHERE id=$2`, [newQty, id]);
          const q = await mengeDesBestands(tx, cfg, ownerId, keys);
          // Auch hier: Eine Erfassung auf 0 zu setzen ist zwar durch
          // Math.max(1, …) oben ausgeschlossen, aber die Regel gehört an die
          // Menge, nicht an den einen Weg dorthin.
          await raeumeLeerenBestand(tx, cfg, ownerId, keys, q);
        }

        if (rawPrice !== undefined) {
          await tx.run(`UPDATE ${cfg.table} SET ${cfg.priceCol}=$1, price_estimated=$2 WHERE id=$3`,
            [priceVal, zielGeschaetzt, id]);
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
          if (cfg.parentConditionSql) {
            const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
            if (latest?.id === id) await tx.run(cfg.parentConditionSql, [cond, ownerId, ...keys]);
          }
        }

        if (_newDate) {
          await tx.run(`UPDATE ${cfg.table} SET created_at=$1::date + interval '12 hours' WHERE id=$2`,
            [_newDate, id]);
          // Nach einer Datumsänderung kann eine ANDERE Erfassung die neueste
          // sein — die Spiegelung in die Elternzeile muss deshalb neu bestimmt
          // werden, sonst zeigt die Kachel den Preis der falschen Zeile.
          // `parentPriceSql ||`, nicht `&&`: Für Sets sind beide null, für
          // Teile und Figuren beide gesetzt — würde hier nur der Preis geprüft,
          // bliebe eine künftige Art mit Zustand ohne Preis unbedient.
          if (cfg.parentPriceSql || cfg.parentConditionSql) {
            const latest = await tx.get(cfg.latestSql, [ownerId, ...keys]);
            const row = latest
              ? await tx.get(`SELECT ${cfg.priceCol} AS p, condition FROM ${cfg.table} WHERE id=$1`, [latest.id])
              : null;
            if (row) {
              if (cfg.parentPriceSql)     await tx.run(cfg.parentPriceSql, [row.p, ownerId, ...keys]);
              if (cfg.parentConditionSql) await tx.run(cfg.parentConditionSql, [row.condition || 'N', ownerId, ...keys]);
            }
          }
        }
      });

      res.json(await withSetAggregate(uid, cfg.table, keys, { success: true }));
    } catch (e) { handleRouteError(res, e, undefined, req); }
  });

  router.delete(put, requireToken, async (req: AuthedRequest, res) => {
    try {
      const uid  = req.apiUser.user_id;
      const id   = parseInt(String(req.params[cfg.idParam]));
      const keys = cfg.keyVals(req);

      const besitzer = await besitzerDerZeile(cfg.table, id, uid);
      const row = await withInventoryLock(besitzer, bestandsSchluessel(cfg.kind, keys), async (tx) => {
        // Wie beim Aktualisieren (Nachtrag 45): über das SCHREIB-Blickfeld
        // suchen, danach mit dem BESITZER der Zeile weiterarbeiten. Vorher
        // konnte das Hauptkonto eine Erfassung des Unterkontos weder ändern
        // noch löschen — es bekam 404.
        const wids = await writableIds(uid);
        const acq = await tx.get(cfg.existsSql, cfg.existsWithKeys ? [id, wids, ...keys] : [id, wids]);
        if (cfg.deleteChecksExistence && !acq) {
          fehlerWerfen(cfg.notFound, 404);
        }
        const ownerId = acq ? parseInt(String(acq.user_id)) : uid;

        await tx.run(`DELETE FROM ${cfg.table} WHERE id=$1 AND user_id=$2`, [id, ownerId]);

        // Preis und Zustand der Elternzeile NEU bestimmen (Nachtrag 75,
        // Marcos Fund: „Kaufpreis entfernt, die Kachel zeigt ihn weiter").
        // Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#withsetaggregate
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
        const menge = await mengeDesBestands(tx, cfg, ownerId, keys);
        await raeumeLeerenBestand(tx, cfg, ownerId, keys, menge);
        return menge;
      });
      res.json(await withSetAggregate(uid, cfg.table, keys, { success: true, new_quantity: row ?? 0 }));
    } catch (e) { handleRouteError(res, e, undefined, req); }
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
              COALESCE(condition, 'N') AS condition, price_estimated, currency,
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
  existsSql: 'SELECT id, user_id, condition, purchase_price AS preis, price_estimated, currency, ((created_at AT TIME ZONE \'UTC\')::date)::text AS tag FROM set_acquisitions WHERE id=$1 AND user_id = ANY($2) AND set_number=$3',
  existsWithKeys: true,
  notFound:  'erfassung_nicht_gefunden',
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
  // Keine Spiegelung mehr — und zwar nicht aus Versehen.
  // Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#get-sets-setnumber-acquisitions
  parentPriceSql: null,
  parentConditionSql: null,
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
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

registerAcquisitionRoutes({
  routeBase: '/parts/:partNumber/:colorId/acquisitions',
  idParam:   'id',
  table:     'part_acquisitions',
  kind:      'part',
  priceCol:  'unit_price',
  keyVals:   req => [req.params.partNumber, parseInt(req.params.colorId) || 0],
  existsSql: 'SELECT id, user_id, condition, unit_price AS preis, price_estimated, currency, ((created_at AT TIME ZONE \'UTC\')::date)::text AS tag FROM part_acquisitions WHERE id=$1 AND user_id = ANY($2)',
  existsWithKeys: false,
  notFound:  'nicht_gefunden',
  deleteChecksExistence: false,
  // cond MITGEBEN
  // Der Aufrufer reicht den Zustand DIESER Zeile durch (siehe oben, Nachtrag
  // 68). Die Sets-Fassung nimmt ihn seit jeher; Teile und Minifiguren liessen
  // ihn fallen und leiteten stattdessen einen Zustand aus ALLEN Erfassungen …
  // Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#get-parts-partnumber-colorid-acquisitions
  resolvePrice: (uid, [pn, cid], cond) =>
    require('../parts').getCurrentPartMarketPrice(pn, cid, uid, cond),
  // Keine Spiegelung mehr — dieselbe Begruendung wie bei den Sets weiter
  // oben, nur eine Migration spaeter: Mit 0035 gibt es unit_price,
  // purchase_price und condition auf der Teilezeile nicht mehr. Die
  // Spiegelung hat kein Ziel, und die Kachel kann gar nicht mehr abweichen —
  // sie liest die neueste Erfassung (getManualParts in utils/handlers/parts.ts).
  parentPriceSql: null,
  parentConditionSql: null,
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
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

registerAcquisitionRoutes({
  routeBase: '/minifigs/:figNumber/acquisitions',
  idParam:   'id',
  table:     'minifig_acquisitions',
  kind:      'fig',
  priceCol:  'unit_price',
  keyVals:   req => [req.params.figNumber],
  existsSql: 'SELECT id, user_id, condition, unit_price AS preis, price_estimated, currency, ((created_at AT TIME ZONE \'UTC\')::date)::text AS tag FROM minifig_acquisitions WHERE id=$1 AND user_id = ANY($2)',
  existsWithKeys: false,
  notFound:  'nicht_gefunden',
  deleteChecksExistence: false,
  // cond mitgeben — siehe die Begründung bei den Teilen.
  // Die BL-Nummer-Abfrage steht in utils/blZuordnung.ts — sie wird auch vom
  // Kaufpreis-Nachtrag gebraucht (jobs/purchasePriceBackfill.ts).
  // Ausführlich: docs/begruendungen/routes/api_v1/acquisitions.ts.md#get-minifigs-fignumber-acquisitions
  resolvePrice: async (uid, [fn], cond) => {
    const blNummer = await blAbrufNummer('fig', fn);
    return getCurrentFigMarketPrice(fn, uid, blNummer, cond);
  },
  // Keine Spiegelung mehr — siehe die Begruendung bei den Teilen darueber.
  parentPriceSql: null,
  parentConditionSql: null,
  latestSql: 'SELECT id FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2 ORDER BY created_at DESC, id DESC LIMIT 1',
  // Nur die manuelle Position — siehe Teile.
  cleanupWhenEmpty: async (tx, ownerId, [fn]) => {
    await loescheManuelleFigur(tx, ownerId, fn);
  },
});

export default router;
