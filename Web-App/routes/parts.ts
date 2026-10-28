import express from 'express';
/*
 * Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der …
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#abschnitt
 */

/*
 * Zusammengelegt mit der v1-Fabrik
 * Neun Routen standen hier doppelt — Liste, manuelle Liste, Farben, Statistik,
 * BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen — je einmal für
 * die Sitzung der Webapp und einmal in routes/api_v1/parts.ts für den Token der …
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#router
 */

const router  = express.Router();
import * as db from '../db/database';
import { fehlertext, handleRouteError } from '../utils/httpError';
import { recordAcquisitionForDay } from '../utils/acquisitions';
import { withInventoryLock, bestandsSchluessel } from '../utils/txLock';
// Die Katalogarbeit liegt seit Nachtrag 131 in utils/partsImport.ts — sonst
// müsste utils/setService.ts (addSet) einen Router importieren.
import { importPartsForSet, fetchMissingBlIds } from '../utils/partsImport';
import { requireLoginOrToken as requireLogin } from '../utils/auth';
// Blickfeld — dieselbe Quelle wie in routes/api_v1/parts.ts.
import { scopeIds, parseScopeMode } from '../utils/household';
import { kaufpreisAusEingabe, manuellerKaufpreis } from '../utils/preisRegel';
// Der Standard-Zustand eines Benutzers. Hiess in routes/sets.ts einmal
// `getUserDefaultCondition` und war dort eine wortgleiche Zweitfassung dieser
// Funktion (Nachtrag 125). Der Alias, weil in dieser Datei mehrfach eine lokale
import { zustandFuerPreis } from '../utils/settings';
// Marktpreis und Zustandsermittlung eines Teils stehen seit dem
// Schichtumbau in utils/marketPrice.ts — dort, wo schon der Set-Preis
// wohnt. Zuvor lagen sie hier, und jobs/ sowie utils/ mussten aus dieser
// ROUTE importieren, um an einen Preis zu kommen.
import { resolvePartCondition, marktpreisMitHerkunft, getCurrentPartMarketPrice } from '../utils/marketPrice';

router.use(requireLogin);

// fetchRebrickableParts() stand hier: 90 Zeilen, die den Teileabruf bei
// Rebrickable ein zweites Mal nachbauten — mit eigener Blätterlogik, eigenem
// 429-Umgang und eigenem Bilddownload, aber OHNE Tageskontingent, ohne Drossel
// und ohne subsets_cache. Aufgerufen wurde sie nur von utils/handlers.ts, und
// zwar über einen Namen, den diese Datei nie exportiert hat: Der Aufruf endete
// immer in einem TypeError. Der Weg läuft jetzt über getAllSetParts() in
// clients/rebrickable.ts, das all das kann.

router.get('/categories', async (req, res) => {
  // Blickfeld statt eigener ID
  // Zwei Filter ueber DERSELBEN Liste mit zwei verschiedenen Blickfeldern: Im
  // Haushalt zaehlte die Farbliste die Teile aller Konten, die Kategorienliste
  // nur die eigenen. Wer nach einer Kategorie filterte, bekam eine Liste, die …
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#get-categories-uids
  const uids = await scopeIds(angemeldeteNutzerId(req), parseScopeMode(req.query.accounts));
  try {
    const cats = await db.all(`
      -- Kategorie auflösen, notfalls über den Teilekatalog.
      --
      -- parts.category_name enthält die Rebrickable-Kategorie-ID als Text —
      -- ODER die Zeichenkette 'Unknown', wenn die Set-Teile-Antwort kein
      -- part_cat_id mitgeliefert hat. Das ist bei /sets/{id}/parts/ die Regel,
      -- nicht die Ausnahme: Das eingebettete part-Objekt führt das Feld meist
      -- nicht. Ergebnis war eine Filterliste mit nur einem Eintrag,
      -- „Unknown".
      --
      -- rb_parts stammt aus dem CSV-Sync und kennt part_cat_id zu jeder
      -- Teilenummer. Über diesen Umweg bekommt auch ein 'Unknown'-Teil seine
      -- Kategorie, ohne dass die gespeicherten Daten angefasst werden müssen.
      --
      -- Die Kategorie kommt seit Migration 0034 aus part_catalog (Alias pc);
      -- vorher stand sie je Konto in parts.
      SELECT COALESCE(rc.id::text, rp_cat.id::text, pc.category_name) AS category_name,
             COALESCE(rc.name, rp_cat.name, 'Unbekannt')              AS label,
             COUNT(DISTINCT p.part_number)::int AS unique_parts,
             -- Der zweite Faktor ist die Zahl der Exemplare DES SETS. Er stand
             -- als COALESCE(s.quantity,1) hier; die Spalte ist mit Migration
             -- 0036 weg, die Menge kommt aus set_acquisitions. Die 1 bleibt
             -- die Lesart „Set nicht im Bestand, Teil trotzdem zaehlen" —
             -- dafuer steht der zweite Parameter von mengeAus().
             -- Der ERSTE Faktor ist die Stückzahl der Bestandszeile. Sie
             -- stand als p.quantity dort; Migration 0038 hat die Spalte
             -- geloescht. Fuer ein Set-Teil ist es die Katalogzahl, fuer
             -- ein manuelles die Summe der Erfassungen — die
             -- Fallunterscheidung steht in utils/bestandsmenge.ts.
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int AS total_quantity
      FROM parts p
      ${mengeJoin('p')}
      ${teilmengeJoin('p', 'part')}
      LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
      LEFT JOIN rb_part_categories rc
             ON rc.id = (CASE WHEN pc.category_name ~ '^[0-9]+$' THEN pc.category_name::int ELSE NULL END)
      LEFT JOIN rb_parts rp ON rp.part_num = p.part_number
      LEFT JOIN rb_part_categories rp_cat ON rp_cat.id = rp.part_cat_id
      WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
      GROUP BY COALESCE(rc.id::text, rp_cat.id::text, pc.category_name),
               COALESCE(rc.name, rp_cat.name, 'Unbekannt')
      ORDER BY total_quantity DESC`, [uids]);
    res.json({ success:true, categories:cats });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── Manual part lookup via Rebrickable ────────────────────────────────────────

// ── GET /api/parts/brick-colors — brick color list for dropdown ───────────────

// Shared logic to get the color list (Rebrickable if configured, else a
// built-in fallback list of common colors). Used by both the session-based
// web route (GET /api/parts/brick-colors) and the token-based API
// (GET /api/v1/parts/colors), so it is implemented exactly once.
async function getPartColorList() {
  const colors = await getBrickColors();
  if (colors.length) return colors;
  // If Rebrickable not configured, return common colors
  return [
    {id:0,name:'[No Color/Any Color]',hex:'FCFCFC'},
    {id:1,name:'White',hex:'F4F4F4'},
    {id:2,name:'Tan',hex:'DEC69C'},
    {id:3,name:'Yellow',hex:'F2CD37'},
    {id:4,name:'Red',hex:'C91A09'},
    {id:5,name:'Dark Red',hex:'720E0F'},
    {id:6,name:'Orange',hex:'FE8A18'},
    {id:7,name:'Blue',hex:'0055BF'},
    {id:8,name:'Dark Blue',hex:'003352'},
    {id:9,name:'Light Blue',hex:'68C3E2'},
    {id:10,name:'Green',hex:'237841'},
    {id:11,name:'Dark Green',hex:'184632'},
    {id:12,name:'Lime',hex:'BBE90B'},
    {id:13,name:'Black',hex:'05131D'},
    {id:14,name:'Dark Bluish Gray',hex:'595D60'},
    {id:15,name:'Light Bluish Gray',hex:'9BA19D'},
    {id:16,name:'Flat Silver',hex:'898788'},
    {id:17,name:'Brown',hex:'583927'},
    {id:18,name:'Dark Brown',hex:'352100'},
    {id:19,name:'Reddish Brown',hex:'82422A'},
    {id:20,name:'Sand Green',hex:'A0BCAC'},
    {id:21,name:'Dark Tan',hex:'958A73'},
    {id:22,name:'Medium Azure',hex:'36AEBF'},
    {id:23,name:'Magenta',hex:'FC97AC'},
    {id:24,name:'Dark Purple',hex:'3F3691'},
    {id:25,name:'Medium Lavender',hex:'AC78BA'},
    {id:26,name:'Coral',hex:'FF698F'},
    {id:27,name:'Nougat',hex:'D09168'},
    {id:28,name:'Gold',hex:'DBAC34'},
  ];
}

/**
 * Preis/Stk, Kaufpreis und Zustand fuer ein manuell erfasstes Teil.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#resolvemanualpartpurchase
 */
async function resolveManualPartPurchase(uid: number, { partNumber, colorId, unitPrice = null, condition = null }:
  { partNumber: string; colorId: number; unitPrice?: any; condition?: string | null }) {
  // Die Regel steht in utils/preisRegel.ts — dort auch, warum ohne Marktpreis
  // eine 0 in der Stammzeile steht und NULL in der Erfassung. Hier bleibt nur,
  // was ein TEIL anders macht als eine Figur: der Schluessel der Abfrage.
  const r = await manuellerKaufpreis(uid, { unitPrice, condition },
    (zustand) => marktpreisMitHerkunft(partNumber, colorId, uid, zustand));
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    // Aus welchem Zustand der uebernommene Marktpreis stammt (Nachtrag 167) —
    // null, wenn es nichts zu kennzeichnen gibt.
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

// Shared logic to add/update a single manual part. Used by both the
// session-based web route (POST /api/parts) and the token-based API
// (POST /api/v1/parts), so the behaviour (incl. Kaufpreis handling) is
// implemented exactly once.
// Ausführlich: docs/begruendungen/routes/parts.ts.md#abschnitt-2
/**
 * Ein Teil von Hand erfassen — mit Lagerort, wenn einer mitkommt.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpart
 */
async function addManualPart(uid: number, rawBody: Record<string, unknown>) {
  const V0 = require('../utils/validate');
  // ortFuerNeuerfassung statt normalisiereLagerort: Kommt kein Ort mit, gilt
  // Marcos Stern (die Begruendung samt Messung steht dort in utils/lagerort.ts).
  const ort = await ortFuerNeuerfassung(uid, rawBody?.storage);
  // DIESELBE Umwandlung wie im Rumpf, auf derselben Eingabe — sie kann also
  // nicht auseinanderlaufen. Der Rumpf gibt sie nicht zurueck, weil die
  // Antwort der Route sonst eine Form mehr haette, die niemand liest.
  const farbe = V0.colorId(rawBody?.color_id);
  const ergebnis = await addManualPartIntern(uid, rawBody);
  if (ort && ergebnis?.part_number) {
    await setzeLagerort('part', [uid], [ergebnis.part_number, String(farbe || 0)], ort);
  }
  return ergebnis;
}

async function addManualPartIntern(uid: number, rawBody: any) {
  // Eingangsvalidierung (utils/validate.ts): vorher wurden part_number,
  // part_name, color_name, category_name und image_url völlig ungeprüft
  // gespeichert und später per innerHTML gerendert — das war die Server-Hälfte
  // der Stored-XSS-Kette. image_url ist jetzt zwingend https.
  const V = require('../utils/validate');
  const part_number = V.requireItemNumber(rawBody?.part_number, 'part_number');
  const color_id    = V.colorId(rawBody?.color_id);
  const color_name  = V.optionalText(rawBody?.color_name, 100);
  const color_hex   = V.optionalHex(rawBody?.color_hex);
  const quantity    = V.acquisitionQuantity(rawBody?.quantity, 1);
  const condition   = V.optionalCondition(rawBody?.condition);
  // Negative Beträge gingen bis hardened-137 durch und wanderten unverändert
  // in die Summen des Finanzreiters.
  const unit_price  = V.optionalPrice(rawBody?.unit_price, 'Stückpreis');
  // Erfassungsdatum: erlaubt mehrere Erfassungen desselben Teils zu
  // verschiedenen Zeitpunkten — wie im CSV-Import, der das längst kann.
  const acquiredAt  = (rawBody?.acquired_at || '').trim() || null;

  let part_name = V.optionalText(rawBody?.part_name, 200);
  let image_url = V.optionalImageUrl(rawBody?.image_url);
  let category_name = V.optionalText(rawBody?.category_name, 100);

  if (!part_name) {
    // Wurde überhaupt eine Farbe gewählt?
    //
    // V.colorId() macht aus null/'' eine 0 — für die Spalte richtig (die
    // Vorgabe ist 0), für die Bildsuche fatal: 0 ist bei Rebrickable SCHWARZ.
    // Die Unterscheidung muss deshalb am Rohwert getroffen und getrennt
    // weitergereicht werden.
    const rawColor = rawBody?.color_id;
    const hasColor = rawColor !== null && rawColor !== undefined && String(rawColor).trim() !== '';

    // Erst der EIGENE Katalog, dann der fremde Dienst
    // Der Import ist dabei nur der Auffaellige. Die Luecke war in DIESER
    // Funktion, und sie gilt fuer jeden Weg, der ohne Namen hereinkommt —
    // auch POST /api/v1/parts. Deshalb steht die Staffelung hier und nicht …
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-lokal
    const lokal = await katalogTeil(part_number, hasColor ? color_id : null);
    if (lokal) {
      part_name     = part_name     || lokal.name;
      category_name = category_name || lokal.kategorie;
      image_url     = image_url     || lokal.bild;
    }

    // Nur fragen, wenn danach noch etwas fehlt. `hatBild` statt `image_url`:
    // Ein bereits heruntergeladenes Bild (`image_local`) darf nicht hierher
    // durchreisen — es ist ein Pfad und faellt bei V.optionalImageUrl durch —,
    // es beweist aber, dass der Abruf nichts mehr zu holen hat.
    if (!part_name || !(image_url || lokal?.hatBild)) {
      const info = await lookupPart(part_number, hasColor ? color_id : null);
      // `||`, nicht Zuweisung: Was der Katalog schon wusste, bleibt stehen.
      // Gefragt wird oft nur noch, weil EIN Stueck fehlte.
      if (info) {
        part_name     = part_name     || info.part_name;
        image_url     = image_url     || info.image_url;
        category_name = category_name || info.category_name;
      }
    }
  }

  // Gibt es die Position schon? Nur die EXISTENZ wird gebraucht — die
  // Stückzahl stand hier als zweite Spalte und ist mit Migration 0038 weg.
  // Gelesen wurde sie ohnehin nicht mehr: Die Menge addiert sich dadurch,
  // dass eine zweite Erfassung entsteht.
  const existing = await db.get(
    "SELECT id FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [uid, part_number, color_id]
  );

  if (existing) {
    // Menge addieren UND eine Erfassung anlegen.
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-recond
    const reCond = ['N','U'].includes(condition) ? condition
      : await resolvePartCondition(uid, part_number, color_id).catch(() => 'N');
    const reEntered = (unit_price !== undefined && unit_price !== null && unit_price !== '')
      ? parseFloat(unit_price) : null;
    const rePrice = (reEntered !== null && !isNaN(reEntered))
      ? reEntered
      : await getCurrentPartMarketPrice(part_number, color_id, uid, reCond);

    // Pro Tag und Zustand EINE Erfassung — wird am selben Tag erneut erfasst,
    // wächst die bestehende Zeile, statt dass eine zweite entsteht
    // (utils/acquisitions.ts).
    await recordAcquisitionForDay('part', uid, [part_number, color_id || 0], {
      quantity, price: ((rePrice ?? 0) > 0 ? rePrice : null), condition: reCond, createdAt: acquiredAt,
      geschaetzt: reEntered === null || isNaN(reEntered),
    });
    // Kein Nachrechnen mehr: Die Stückzahl steht seit Migration 0038
    // nicht an der Zeile. Hier stand mengeNeuRechnen(), das sie aus den
    // Erfassungen ableitete und SCHRIEB — jetzt rechnet sie das Lesen
    // (utils/bestandsmenge.ts, teilmengeJoin/teilmengeAus).

    return { action: 'updated', part_number };
  }

  // Preis/Stk, Kaufpreis und Zustand: eine Rechnung, eine Stelle
  // (resolveManualPartPurchase oben) — dieselbe, die der CSV-Import benutzt.
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern
  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } =
    await resolveManualPartPurchase(uid, { partNumber: part_number, colorId: color_id, unitPrice: unit_price, condition });
  // Farbcode möglichst füllen: vom Client übergeben, sonst aus rb_colors ableiten
  // (sonst bleibt der Farbpunkt in der Oberfläche grau).
  const effectiveColorHex = color_hex
    || (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [color_id]).catch(() => null))?.rgb
    || null;

  // Beschreibung in den Katalog, Bestand in parts
  // Seit Migration 0034 trennt sich beides: Name, Farbbezeichnung, Farbcode,
  // Kategorie und Bild gelten fuer ALLE Konten, der Bestand gilt fuer eines.
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-2
  await merkeTeil(part_number, part_name, category_name);
  await merkeTeilFarbe(part_number, color_id, color_name, effectiveColorHex, image_url);

  // Preis und Zustand nicht mehr an die Bestandszeile (Migration 0035) — sie
  // stehen in der Erfassung, die recordAcquisitionForDay() gleich darunter
  // anlegt. effectiveUnitPrice/effectivePurchasePrice werden dort ueber
  // erfassungsPreis verwendet.
  // Ohne Menge: Sie steht seit Migration 0038 nicht an der Zeile. Fuer ein
  // manuelles Teil ist sie die Summe der Erfassungen, und die erste legt
  // recordAcquisitionForDay() gleich darunter an.
  await db.run(`
    INSERT INTO parts (user_id, set_number, part_number, color_id, source)
    VALUES ($1, NULL, $2, $3, 'manual') ON CONFLICT DO NOTHING`,
    [uid, part_number, color_id]
  );

  // Gibt es das Teil schon, hat das INSERT oben nichts getan (ON CONFLICT DO
  // NOTHING) — und das genuegt: Eine zweite Erfassung ist ein Zugang, kein
  // Fehler, und sie addiert sich von selbst, weil die Stückzahl die SUMME der
  // Erfassungen ist (Migration 0038). Hier stand dafuer ein eigenes …
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-3
  await recordAcquisitionForDay('part', uid, [part_number, color_id || 0], {
    quantity, price: erfassungsPreis, geschaetzt,
    condition: effectiveCondition, createdAt: acquiredAt,
  });

  // `price_from_condition` sagt der Oberflaeche, dass der uebernommene
  // Marktpreis aus dem ANDEREN Zustand stammt (Nachtrag 167, Marcos
  // Entscheidung „uebernehmen, aber kennzeichnen"). Null, wenn es nichts zu
  // sagen gibt — dann zeigt keine der beiden Oberflaechen einen Hinweis.
  return { action: 'added', part_number, part_name, price_from_condition: preisAusZustand };
}

// Shared logic to update quantity and/or Preis/Stk (unit_price, which doubles
// as the Kaufpreis baseline — same rule as when adding) of a manually captured
// part. Used by both the session-based web route and the token-based API, so
// the behaviour is implemented exactly once.
async function updateManualPart(uid: number, partNumber: string, colorId: number, body: any) {
  // Der Zustand kommt aus der NEUESTEN Erfassung — an der Bestandszeile gibt
  // es ihn seit Migration 0035 nicht mehr. Dieselbe Ordnung wie latestSql in
  // routes/api_v1/acquisitions.ts.
  const existing = await db.get(
    `SELECT p.id,
            (SELECT a.condition FROM part_acquisitions a
              WHERE a.user_id = p.user_id AND a.part_number = p.part_number
                AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0)
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM parts p
      WHERE p.user_id=$1 AND p.part_number=$2 AND p.color_id=$3 AND p.source='manual'`,
    [uid, partNumber, colorId]
  );
  if (!existing) { const e = Object.assign(new Error('Teil nicht gefunden oder nicht manuell hinzugefügt'), { status: 404 }); throw e; }

  if (body.quantity !== undefined) {
    const newQty = bestandsMenge(body.quantity, 1);
    // Marktpreis VOR der Sperre holen (Netzaufruf) und nur, wenn die Menge
    // steigt — das schont das BrickLink-Kontingent.
    const cond = await zustandFuerPreis(undefined, existing.condition, uid);
    const bisher = (await db.get(
      'SELECT COALESCE(SUM(quantity), 0)::int AS q FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3',
      [uid, partNumber, colorId]))?.q ?? 0;
    const mp = newQty > bisher
      ? await getCurrentPartMarketPrice(partNumber, colorId, uid, cond).catch(() => null) : null;
    // Unter der Bestandssperre: Lesen, Delta rechnen und Schreiben dürfen sich
    // nicht mit einer gleichzeitigen Änderung (Web und App) überholen.
    await withInventoryLock(uid, bestandsSchluessel('part', [partNumber, colorId]), async (tx) => {
      const acqs = await tx.all('SELECT id, quantity, created_at FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3 ORDER BY created_at DESC, id DESC',
        [uid, partNumber, colorId]);
      const currentTotal = acqs.reduce((s: number, r: any) => s + r.quantity, 0);
      const delta = newQty - currentTotal;
      if (delta > 0) {
        await recordAcquisitionForDay('part', uid, [partNumber, colorId],
          { quantity: delta, price: mp, condition: cond, geschaetzt: true }, tx);
      } else if (delta < 0) {
        let rem = -delta;
        for (const a of acqs) {
          if (rem <= 0) break;
          const take = Math.min(a.quantity, rem);
          if (take >= a.quantity) await tx.run('DELETE FROM part_acquisitions WHERE id=$1', [a.id]);
          else await tx.run('UPDATE part_acquisitions SET quantity=quantity-$1 WHERE id=$2', [take, a.id]);
          rem -= take;
        }
      }
    });
  }
  if (body.unit_price !== undefined) {
    // Die Regel („leer heisst Marktpreis", Zustand gestaffelt) steht in
    // utils/preisRegel.ts — sie galt vorher zeichengleich hier und in
    // routes/minifigs.ts. Hier bleibt nur, was sich unterscheidet: welche
    // Marktpreis-Abfrage und welche Tabelle.
    const { unitPrice } = await kaufpreisAusEingabe(
      body.unit_price, body.condition, existing.condition, uid,
      (zustand) => getCurrentPartMarketPrice(partNumber, colorId, uid, zustand),
    );
    // In die NEUESTE Erfassung, nicht an die Bestandszeile
    // purchasePrice wird gar nicht mehr ausgepackt: Er war der ANZEIGEWERT
    // (nie NULL, 0 heisst „nichts bekannt"), und den bildet jetzt die
    // Leseabfrage mit COALESCE(..., 0). In der Erfassung bedeutet 0 „fuer …
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#updatemanualpart-3
    await db.run(
      `UPDATE part_acquisitions SET unit_price = NULLIF($1::numeric, 0)
        WHERE id = (SELECT a.id FROM part_acquisitions a
                     WHERE a.user_id=$2 AND a.part_number=$3
                       AND COALESCE(a.color_id, 0) = COALESCE($4, 0)
                     ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
      [unitPrice, uid, partNumber, colorId]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    // Ebenfalls in die neueste Erfassung. Das try/catch mit dem Hinweis
    // „migration pending?" ist weg: Es deckte eine Zeit ab, in der die Spalte
    // parts.condition noch fehlen konnte. Jetzt gibt es sie nicht mehr, und
    // ein Fehlschlag soll nicht verschwiegen werden.
    await db.run(
      `UPDATE part_acquisitions SET condition=$1
        WHERE id = (SELECT a.id FROM part_acquisitions a
                     WHERE a.user_id=$2 AND a.part_number=$3
                       AND COALESCE(a.color_id, 0) = COALESCE($4, 0)
                     ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
      [cond, uid, partNumber, colorId]);
  }
}

// ── POST /api/parts — add a single manual part ────────────────────────────────
// Body: { part_number, color_id?, color_name?, quantity, unit_price? }

// ── PUT /api/parts/:partNumber/:colorId — edit quantity / Preis/Stk ──────────

// ── DELETE /api/parts/:partNumber/:colorId — delete a manual part ─────────────

// ── POST /api/parts/import/csv — CSV import of manual parts ──────────────────
// CSV columns: part_number, color_id (opt), color_name (opt), quantity, unit_price (opt)
import { getBrickColors, lookupPart } from '../clients/rebrickable';
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage } from '../utils/csvExport';
import { buildPartsCsv } from '../utils/bestandExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from '../utils/lagerort';
import { merkeTeil, merkeTeilFarbe, katalogTeil } from '../utils/katalogPflege';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../utils/bestandsmenge';
import { bestandsMenge } from '../utils/validate';

router.post('/import/csv', csvEmpfang.single('file'), async (req: LoggedInRequest, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const uid = angemeldeteNutzerId(req);
  try {
    // Einlesen, entschaerfen, zaehlen — gemeinsam mit dem anderen Import
    // (utils/csvExport.ts, csvZeilenAusAnfrage).
    const { records, bereinigt, uebersprungen } =
      csvZeilenAusAnfrage(req.file.buffer.toString('utf-8'));

    let added = 0, updated = 0, errors = 0;
    const results: any[] = [];

    for (const row of bereinigt) {
      const partNumber = (row.part_number || row['Teilenummer'] || row['part_num'] || Object.values(row)[0] || '').trim();
      if (!partNumber) continue;

      const colorId    = parseInt(row.color_id || row['Farb-ID'] || '0') || 0;
      const colorName  = row.color_name  || row['Farbe']     || null;
      // Menge, Preis, Datum und Zustand liest csvGemeinsameFelder — es sind
      // dieselben Spalten wie beim Minifiguren-Import, und dort ist eine
      // Behebung schon einmal liegen geblieben (utils/csvExport.ts).
      const { menge: qty, preis: unitPrice,
              erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);

      try {
        // Lookup from Rebrickable
        let partName = row.part_name || row['Name'] || null;
        let imageUrl: any = null, categoryName: any = null;
        if (!partName) {
          const info = await lookupPart(partNumber, colorId);
          if (info) { partName = info.part_name; imageUrl = info.image_url; categoryName = info.category_name; }
        }

        // Dieselbe Rechnung wie beim Anlegen von Hand — eine Stelle,
        // resolveManualPartPurchase. Zwei Unterschiede fielen damit weg:
        // unit_price bekam hier den MARKTPREIS (das Feld heisst „Preis/Stk"
        // und meint, was der Mensch bezahlt hat), und ohne Marktpreis stand
        // NULL im Kaufpreis statt der 0, die das Frontend erwartet.
        // Ohne effectiveUnitPrice/effectivePurchasePrice — siehe addManualPart.
        const { erfassungsPreis, effectiveCondition: csvCondition, geschaetzt } =
          await resolveManualPartPurchase(uid, { partNumber, colorId, unitPrice, condition: rawCondition });
        const acqDate = acquiredAt || new Date().toISOString().slice(0,10);

        const existing = await db.get(
          "SELECT id FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
          [uid, partNumber, colorId]
        );
        if (existing) {
          // Keine Mengenaenderung hier — die Erfassung unten ist die Wahrheit
          // (utils/bestandsmenge.ts).
          // Erfassung auch beim Aufstocken anlegen, damit Zustand/Preis/Datum der
          // importierten Menge erhalten bleiben (und das Zustands-Aggregat stimmt).
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            // > 0 wie beim Anlegen von Hand: Die 0 ist ein Anzeigewert fuer
            // die Stammzeile, in der Erfassung steht dafuer NULL.
            { quantity: qty, price: erfassungsPreis, geschaetzt,
              condition: csvCondition||'N', createdAt: acqDate });
          updated++;
          results.push({ part_number: partNumber, action: 'updated' });
        } else {
          const colorHex = (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [colorId]).catch(() => null))?.rgb || null;
          // Beschreibung in den Katalog, Bestand in parts (Migration 0034).
          // Der Katalog zuerst, aus demselben Grund wie beim Anlegen von
          // Hand: lieber eine Beschreibung ohne Bestand als ein Bestand ohne
          // Beschreibung.
          await merkeTeil(partNumber, partName, categoryName);
          await merkeTeilFarbe(partNumber, colorId, colorName, colorHex, imageUrl);
          // Preis und Zustand in die Erfassung, nicht an die Bestandszeile
          // (Migration 0035) — siehe addManualPart.
          // Ohne Menge — siehe addManualPart (Migration 0038).
          await db.run(`INSERT INTO parts (user_id, set_number, part_number, color_id, source)
            VALUES ($1, NULL, $2, $3, 'manual') ON CONFLICT DO NOTHING`,
            [uid, partNumber, colorId]);
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            // > 0 wie beim Anlegen von Hand: Die 0 ist ein Anzeigewert fuer
            // die Stammzeile, in der Erfassung steht dafuer NULL.
            { quantity: qty, price: erfassungsPreis, geschaetzt,
              condition: csvCondition||'N', createdAt: acqDate });
          added++;
          results.push({ part_number: partNumber, action: 'added' });
        }
      } catch (e) {
        errors++;
        results.push({ part_number: partNumber, action: 'error', error: fehlertext(e) });
      }
    }

    csvImportAntwort(res, { added, updated, errors, records, results, uebersprungen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/parts/manual — list only manually added parts ────────────────────


// ── GET /api/parts/export/csv ist ENTFERNT ───────────────────────────────────
//
// Kein Aufrufer; die Webapp exportiert ueber /api/settings/export/data (ZIP mit
// drei CSV-Dateien), das dieselbe Funktion benutzt. Siehe routes/sets.ts.

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── part_acquisitions: CRUD ──────────────────────────────────────────────────

// partIsToday() stand hier — ein Datumsvergleich ohne Aufrufer. Entfallen.

/**
 * Erfassungen eines Teils — fuer den Kaufpreis-Dialog.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#getpartacquisitions
 */
async function getPartAcquisitions(uid: number[], partNumber: string, colorId: string | number) {
  // uid ist hier das BLICKFELD (Liste): Im Haushalt können die Kaufpreise
  // eines Teils mehreren Konten gehören, und je Zeile kommt der Eigentümer
  // mit — sonst wüsste die Auswahl im Dialog nicht, worauf sie steht.
  //  Kein Rueckfall auf die Stammzeile mehr
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#getpartacquisitions-2
  return db.all(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM part_acquisitions a
     WHERE a.user_id = ANY($1) AND a.part_number=$2 AND a.color_id=$3
     ORDER BY a.created_at ASC, a.id ASC`,
    [uid, partNumber, parseInt(String(colorId)) || 0]
  );
}

export = Object.assign(router, { fetchMissingBlIds, importPartsForSet, getCurrentPartMarketPrice, addManualPart, updateManualPart, lookupPart, getPartColorList, buildPartsCsv, getPartAcquisitions });
