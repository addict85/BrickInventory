import express from 'express';
/*
 * ── Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts ──
 *
 * Marcos Vorgabe (Nachtrag 70): „Können die beiden Apps nicht die gleichen APIs
 * nutzen (mit unterschiedlichen Authentifizierungsarten), damit die Logik nur
 * einmal implementiert werden muss und das Verhalten immer gleich ist?"
 *
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der
 * letzten Fehlermeldungen — Kaufpreis, Menge, Löschen, Erfassungen im Haushalt,
 * Preisauffüllung, und zuletzt zwei verschiedene Marktpreise für denselben
 * Vorgang (18.90 gegen 12.55).
 *
 * Möglich wurde der Schnitt, weil requireToken in routes/api_v1/middleware.ts
 * BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER Bearer-Token. Es brauchte
 * also keine neue Schicht, nur das Entfernen der Zweitfassung. Die Webapp ruft
 * jetzt /api/v1/... — dieselbe Adresse wie die App.
 */

/*
 * ── Zusammengelegt mit der v1-Fabrik (Nachtrag 73) ──────────────────────────
 *
 * Neun Routen standen hier doppelt — Liste, manuelle Liste, Farben, Statistik,
 * BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen — je einmal für
 * die Sitzung der Webapp und einmal in routes/api_v1/parts.ts für den Token der
 * App. Sie sind entfernt; beide Clients rufen jetzt /api/v1/parts/…, weil
 * requireToken BEIDE Ausweise akzeptiert.
 *
 * Vor dem Entfernen wurden ALLE Paare gegeneinander gemessen — Antwort UND
 * vollständiger Datenbankzustand, lesend wie schreibend (anlegen, ändern,
 * löschen, Haushaltskonto, Fehlerfälle). Ergebnis: identisch. Einziger
 * Unterschied: Die Liste nennt jetzt zusätzlich `page` und `page_size` — und
 * zwar den TATSÄCHLICH verwendeten Wert statt eines Echos der Anfrage. Das ist
 * mehr Information, keine andere Auswahl; beide Wege nutzen denselben Handler.
 *
 * HIER GEBLIEBEN sind /categories, /import/csv und /export/csv: Die gibt es nur
 * an einem Ort und können nicht auseinanderlaufen.
 */

const router  = express.Router();
import * as db from '../db/database';
import { fehlertext, handleRouteError, logAndContinue } from '../utils/httpError';
import { recordAcquisitionForDay } from '../utils/acquisitions';
// Die Katalogarbeit liegt seit Nachtrag 131 in utils/partsImport.ts — sonst
// müsste utils/setService.ts (addSet) einen Router importieren.
import { importPartsForSet, fetchMissingBlIds } from '../utils/partsImport';
import { requireLogin } from './auth';
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
  // ── Blickfeld statt eigener ID (Nachtrag 134) ─────────────────────────────
  //
  // Hier stand `angemeldeteNutzerId(req)` — die eigene Konto-ID, ohne
  // `accounts`. Der ZWILLING dieser Route, /parts/colors, liest das Blickfeld
  // seit jeher (routes/api_v1/parts.ts:115 → scopeIds + parseScopeMode).
  //
  // Zwei Filter ueber DERSELBEN Liste mit zwei verschiedenen Blickfeldern: Im
  // Haushalt zaehlte die Farbliste die Teile aller Konten, die Kategorienliste
  // nur die eigenen. Wer nach einer Kategorie filterte, bekam eine Liste, die
  // zu keiner der beiden Zahlen darueber passte.
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
             COUNT(DISTINCT p.part_number) AS unique_parts,
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
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}) AS total_quantity
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
 *
 * ── Warum es das jetzt gibt ─────────────────────────────────────────────────
 * Bei den Minifiguren steht diese Rechnung EINMAL (resolveManualFigPurchase in
 * routes/minifigs.ts) und hat drei Aufrufer: Anlegen, Bearbeiten, CSV-Import.
 * Bei den Teilen stand sie an jeder Stelle neu — und die beiden Fassungen im
 * Anlegen und im CSV-Import sagten zweierlei:
 *
 *  1. Preis/Stk. Der CSV-Import schrieb den MARKTPREIS in unit_price. Das Feld
 *     heisst „Preis/Stk" und bedeutet „was der Mensch bezahlt hat"; ohne Angabe
 *     in der Datei gehoert dort NULL hin, so wie beim Anlegen von Hand. Der
 *     Nachtrag-Job (jobs/purchasePriceBackfill.ts, backfillFromUnitPrice) liest
 *     unit_price ausdruecklich als „wurde beim Erfassen eingegeben" — ein
 *     importiertes Teil behauptete also eine Eingabe, die es nie gab.
 *
 *  2. Kaufpreis ohne Marktpreis. Beim Anlegen wird bewusst 0 gespeichert statt
 *     NULL, sonst zeigt das Kaufpreis-Feld dauerhaft den „Marktpreis"-Platz-
 *     halter (siehe Kommentar unten im Anlegen-Zweig). Der CSV-Import schrieb
 *     NULL — dasselbe Teil sah je nach Erfassungsweg anders aus.
 *
 * Beides faellt weg, sobald die Rechnung nur noch an einer Stelle steht.
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
  };
}

// Shared logic to add/update a single manual part. Used by both the
// session-based web route (POST /api/parts) and the token-based API
// (POST /api/v1/parts), so the behaviour (incl. Kaufpreis handling) is
// implemented exactly once.
//
// "Preis/Stk" (unit_price) doubles as the Kaufpreis baseline: if the user
// enters a price it is used as both the current value override AND the
// purchase-price baseline for the G&V calculation; if left empty, the
// current BrickLink market price is used for both.
// rawBody ist `any` — so kommt es von Express, und so nehmen es auch die
// Validierer in utils/validate.ts entgegen. Der Gewinn liegt bei ihren
// RUECKGABEN: V.colorId() gibt number, V.requireItemNumber() gibt string.
// Ein `unknown` hier waere strenger, aber jeder Feldzugriff muesste dann
// einzeln eingeengt werden, bevor der Validierer ihn ueberhaupt sieht.
/**
 * Ein Teil von Hand erfassen — mit Lagerort, wenn einer mitkommt.
 *
 * ── Warum der Lagerort NACH dem Erfassen geschrieben wird ───────────────────
 *
 * Marcos Befund vom 24.09.: „Bei den manuell erfassten Teilen kann ich beim
 * Erfassen keinen Lagerort setzen." Dieselbe Luecke wie beim Set, und dieselbe
 * Antwort: setzeLagerort() ist die eine Stelle, die die Spalte schreibt —
 * Laengengrenze, Trimmen und der Eintrag im VORRAT (stelleOrteSicher) haengen
 * daran. Ein eigenes UPDATE in dieser Funktion waere die zweite Fassung
 * derselben Regel, und der neu getippte Ort fehlte danach in der Auswahlliste.
 *
 * Der Rumpf hat zwei Ausgaenge — „added" und „updated" —, deshalb die Huelle:
 * Beide Wege sollen den Ort setzen, und zwar genau einmal.
 *
 * GEPRUEFT wird vorher: Ein zu langer Name soll nicht erst das Teil anlegen
 * und dann absagen.
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

    // ── Erst der EIGENE Katalog, dann der fremde Dienst ─────────────────────
    //
    // Hier stand nur der lookupPart()-Aufruf, und das war Marcos Befund vom
    // 20.10.: „Wird jedes Teil bei Rebrickable abgefragt auch wenn es lokal
    // bereits vorhanden ist?" — ja, wurde es. GEMESSEN am laufenden Server
    // ging fuer Teil 3001 in Farbe 4 ein Abruf an
    // rebrickable.com/api/v3/lego/parts/, obwohl Name UND Farbbild im Katalog
    // standen. lookupPart macht zwei Abrufe (Teil, dann Farbbild), jeder durch
    // die Hintergrunddrossel mit 1,5 Sekunden Abstand: beim Import einer
    // Wanted-Liste mit 224 Posten elf Minuten Warten und 448 Abrufe aus dem
    // Tageskontingent, fuer Daten, die dalagen.
    //
    // Der Import ist dabei nur der Auffaellige. Die Luecke war in DIESER
    // Funktion, und sie gilt fuer jeden Weg, der ohne Namen hereinkommt —
    // auch POST /api/v1/parts. Deshalb steht die Staffelung hier und nicht
    // in utils/wantedListe.ts.
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
    //
    // Vorher endete der Pfad hier: Ein erneut erfasstes Teil bekam keine neue
    // Zeile in part_acquisitions. Damit fehlte der Kaufpreis der zweiten
    // Erfassung, und ein abweichendes Erfassungsdatum ging verloren — genau
    // das gemeldete Verhalten. Der CSV-Import macht an dieser Stelle seit
    // jeher beides.
    // Die Menge wird NICHT hier fortgeschrieben: Die Erfassung unten ist die
    // Wahrheit, und seit Migration 0038 gibt es gar keine Spalte mehr, die
    // man fortschreiben koennte. Hier stand `quantity = quantity + $1`.
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
    }).catch(e => console.error('[addManualPart] Zweiterfassung:', e.message));
    // Kein Nachrechnen mehr: Die Stückzahl steht seit Migration 0038
    // nicht an der Zeile. Hier stand mengeNeuRechnen(), das sie aus den
    // Erfassungen ableitete und SCHRIEB — jetzt rechnet sie das Lesen
    // (utils/bestandsmenge.ts, teilmengeJoin/teilmengeAus).

    return { action: 'updated', part_number };
  }

  // Preis/Stk, Kaufpreis und Zustand: eine Rechnung, eine Stelle
  // (resolveManualPartPurchase oben) — dieselbe, die der CSV-Import benutzt.
  //
  // Der Marktpreis wird dort mit dem AUFGELOESTEN Zustand geholt statt mit der
  // rohen Eingabe. Das ist derselbe Wert: Ohne Eingabe fiel
  // getCurrentPartMarketPrice bisher intern auf resolvePartCondition zurueck,
  // und die kennt beim Anlegen noch keine Erfassung — sie lieferte also
  // ebenfalls den Standardzustand des Kontos. Nur steht die Staffelung jetzt
  // sichtbar da, statt zweimal auf verschiedenen Wegen berechnet zu werden.
  // effectiveUnitPrice und effectivePurchasePrice werden hier NICHT mehr
  // ausgepackt: Sie waren fuer die Bestandszeile, und die traegt seit
  // Migration 0035 keinen Preis. Der Compiler hat die Stelle gemeldet, sobald
  // die Spalten weg waren — ein Wert, den niemand mehr liest, ist der beste
  // Beleg dafuer, dass er nur die Abschrift getragen hat.
  const { erfassungsPreis, effectiveCondition, preisAusZustand } =
    await resolveManualPartPurchase(uid, { partNumber: part_number, colorId: color_id, unitPrice: unit_price, condition });
  // Farbcode möglichst füllen: vom Client übergeben, sonst aus rb_colors ableiten
  // (sonst bleibt der Farbpunkt in der Oberfläche grau).
  const effectiveColorHex = color_hex
    || (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [color_id]).catch(() => null))?.rgb
    || null;

  // ── Beschreibung in den Katalog, Bestand in parts ───────────────────────
  //
  // Seit Migration 0034 trennt sich beides: Name, Farbbezeichnung, Farbcode,
  // Kategorie und Bild gelten fuer ALLE Konten, der Bestand gilt fuer eines.
  //
  // Der Katalog ZUERST: Faellt die Anfrage zwischen den beiden Anweisungen
  // aus, steht lieber eine Beschreibung ohne Bestand da (unsichtbar, weil
  // niemand das Teil hat) als ein Bestand ohne Beschreibung (eine Zeile ohne
  // Namen in der Teileliste).
  //
  // Die beiden Upserts stehen in utils/katalogPflege.ts — derselbe Schreiber
  // wie beim CSV-Import, beim Set-Import und beim Verschieben eines Sets.
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
  // Erfassungen ist (Migration 0038). Hier stand dafuer ein eigenes
  // `UPDATE parts SET quantity = quantity + $1`.
  // Erfassung anlegen — analog zu Sets (recordAcquisition in routes/sets.ts).
  //
  // Vorher entstand beim manuellen Anlegen KEINE Zeile in part_acquisitions:
  // Der Kaufpreis stand nur in der Stammtabelle, und Detailansicht wie
  // Zustandsregel arbeiten mit den Erfassungen. Ein frisch angelegtes Teil hatte
  // damit sichtbar keinen Kaufpreis.
  await recordAcquisitionForDay('part', uid, [part_number, color_id || 0], {
    quantity, price: erfassungsPreis,
    condition: effectiveCondition, createdAt: acquiredAt,
  }).catch(e => console.error('[addManualPart] Erfassung:', e.message));

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
    const newQty = parseInt(body.quantity) || 1;
    // ── Erst die Erfassungen, dann die Menge daraus ────────────────────────
    //
    // Hier stand `UPDATE parts SET quantity=$1` VOR dem Angleichen der
    // Erfassungen, und das Angleichen lag in einem try/catch, das seinen
    // Fehler verschluckte („so a missing table never breaks qty save").
    // Scheiterte es, standen Menge und Erfassungen dauerhaft verschieden da —
    // lautlos.
    //
    // Jetzt ist die Reihenfolge umgekehrt und das Verschlucken weg: Geht das
    // Angleichen schief, hat sich NICHTS geaendert, und der Fehler wird
    // gemeldet. Die Spalte schreibt mengeNeuRechnen() danach aus den
    // Erfassungen (utils/bestandsmenge.ts).
    {
      const acqs = await db.all('SELECT id, quantity, created_at FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3 ORDER BY created_at DESC, id DESC',
        [uid, partNumber, colorId]);
      const currentTotal = acqs.reduce((s,r)=>s+r.quantity,0);
      const delta = newQty - currentTotal;
      // acqs.length === 0 wird MIT abgedeckt.
      //
      // Vorher lautete die Bedingung `delta > 0 && acqs.length > 0`: Ohne eine
      // einzige bestehende Erfassung passierte beim Erhöhen gar nichts — die
      // Menge stieg, die Erfassungsliste blieb leer. Heute legen zwar alle
      // Anlagepfade eine erste Zeile an, sodass der Fall selten ist; er tritt
      // aber bei Altbeständen aus der Zeit davor auf, und dann fehlt jede
      // Rückmeldung. Ohne bestehende Erfassung ist eine neue anzulegen genau
      // das Richtige — derselbe Zweig wie "neueste Erfassung ist nicht von
      // heute".
      if (delta > 0) {
        // Aufstocken der heutigen Zeile ODER eine neue anlegen — beides
        // erledigt recordAcquisitionForDay (utils/acquisitions.ts). Vorher
        // stand die Tagesprüfung hier von Hand (`isToday_`) und galt nur an
        // dieser einen Stelle; jetzt gilt sie überall gleich.
        // Der Preis wird UNTEN geholt — erst muss der Zustand feststehen
        // (Nachtrag 147, dieselbe Lücke wie bei den Minifiguren).
        // Zustand der neuen Erfassung folgt dem Teil selbst (bzw. dem
        // User-Default), nicht hartkodiert 'N' — sonst bekäme ein als
        // "Gebraucht" geführtes Teil bei jeder Mengen-Erhöhung eine
        // "Neu"-Erfassung. Der Standard-Zustand kommt aus utils/settings.ts;
        // lazy require wegen des Zyklus parts↔sets.
        // Beim Erfassen gibt es keine Zustandseingabe — dieselbe Staffelung wie
        // beim Bearbeiten, nur ohne den ersten Schritt (utils/settings.ts).
        const cond = await zustandFuerPreis(undefined, existing.condition, uid);
        const mp = await getCurrentPartMarketPrice(partNumber, colorId, uid, cond).catch(()=>null);
        await recordAcquisitionForDay('part', uid, [partNumber, colorId],
          { quantity: delta, price: mp, condition: cond });
      } else if (delta < 0) {
        let rem = -delta;
        for (const a of acqs) {
          if (rem<=0) break;
          const take = Math.min(a.quantity, rem);
          if (take>=a.quantity) await db.run('DELETE FROM part_acquisitions WHERE id=$1', [a.id]);
          else await db.run('UPDATE part_acquisitions SET quantity=quantity-$1 WHERE id=$2', [take, a.id]);
          rem -= take;
        }
      }
    }
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
    // ── In die NEUESTE Erfassung, nicht an die Bestandszeile ──────────────
    //
    // Hier stand `UPDATE parts SET unit_price=$1, purchase_price=$2`. Die
    // beiden Spalten hat Migration 0035 geloescht; der Preis gehoert je Kauf
    // in die Erfassung. Geaendert wird die neueste — das ist die, die alle
    // Leseabfragen als „der Preis dieses Teils" anzeigen.
    //
    // purchasePrice wird gar nicht mehr ausgepackt: Er war der ANZEIGEWERT
    // (nie NULL, 0 heisst „nichts bekannt"), und den bildet jetzt die
    // Leseabfrage mit COALESCE(..., 0). In der Erfassung bedeutet 0 „fuer
    // null Franken gekauft" — deshalb NULLIF.
    await db.run(
      `UPDATE part_acquisitions SET unit_price = NULLIF($1, 0)
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
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage, toCsv } from '../utils/csvExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from '../utils/lagerort';
import { merkeTeil, merkeTeilFarbe, katalogTeil } from '../utils/katalogPflege';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../utils/bestandsmenge';

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
        const { erfassungsPreis, effectiveCondition: csvCondition } =
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
            { quantity: qty, price: erfassungsPreis,
              condition: csvCondition||'N', createdAt: acqDate }
          ).catch(logAndContinue(`teile:import ${partNumber}/${colorId} (aufgestockt)`));
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
            { quantity: qty, price: erfassungsPreis,
              condition: csvCondition||'N', createdAt: acqDate }
          ).catch(logAndContinue(`teile:import ${partNumber}/${colorId} (neu)`));
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

// Shared logic to build the Teile CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
//
// ── EINE Abfrage statt einer je Teil (Nachtrag 134) ──────────────────────────
//
// Hier stand `for (const p of parts) { await db.all(...) }` — bei 2000 manuell
// erfassten Teilen also 2001 Abfragen fuer einen Export. Die beiden
// ZWILLINGSFUNKTIONEN sind laengst umgestellt: buildFigsCsv (routes/minifigs.ts,
// FIGS_CSV_SQL) und buildSetsCsv (utils/setService.ts, SETS_CSV_SQL). Ihre
// Kommentare beschreiben genau diesen Umbau; die Teile blieben als einzige
// zurueck. Wieder eine Regel, die an zwei von drei Stellen gilt.
//
// ── Der Rueckfall auf die Stammzeile ist weg ─────────────────────────────────
//
// Hier stand je Spalte ein `CASE WHEN a.id IS NULL THEN p.<spalte>` und
// darunter eine zweite, vollstaendige Abfrage fuer den Fall, dass
// part_acquisitions ganz fehlt. Beides griff auf p.unit_price und p.condition
// zu, und die hat Migration 0035 geloescht.
//
// Gebraucht wird der Rueckfall auch nicht mehr: 0035 traegt fuer jede manuelle
// Position eine Erfassung nach und prueft danach nach, dass keine ohne
// geblieben ist. Der LEFT JOIN bleibt trotzdem — loescht jemand die letzte
// Erfassung, entfernt cleanupWhenEmpty() die Bestandszeile mit, aber ein
// Export soll an einer unerwarteten Lage nicht ganz ausfallen.
const PARTS_CSV_SQL = `
  SELECT p.part_number,
         -- Die Menge der ERFASSUNG, ohne Rueckfall auf die Zeile: Migration
         -- 0038 hat p.quantity geloescht, und dieser Export liefert eine
         -- Zeile JE ERFASSUNG (source='manual' unten). Ohne Erfassung gibt
         -- es keine Zeile und damit keine Menge — 0 statt leer, dieselbe
         -- Lesart wie im Sets-Export (utils/setService.ts).
         COALESCE(a.quantity, 0) AS quantity,
         COALESCE(p.color_id, 0) AS color_id,
         COALESCE(pcc.color_name,'') AS color_name,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS acquired_at
    FROM parts p
    LEFT JOIN part_acquisitions a
           ON a.user_id = p.user_id
          AND a.part_number = p.part_number
          AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0)
    -- Name und Farbbezeichnung aus den Katalogen (Migration 0034). LEFT JOIN,
    -- damit ein Teil ohne Katalogzeile nicht aus dem Export faellt.
    LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                    AND pcc.color_id    = p.color_id
   WHERE p.user_id = $1 AND p.source = 'manual'
   ORDER BY pc.part_name ASC, p.part_number ASC, a.created_at ASC, a.id ASC`;

async function buildPartsCsv(uid: number) {
  // Ohne zweite Abfrage als Rueckfall — siehe die Begruendung bei
  // PARTS_CSV_SQL. Scheitert sie, soll der Fehler sichtbar werden, statt eine
  // Abfrage zu versuchen, die auf geloeschte Spalten zeigt.
  const rows = (await db.all(PARTS_CSV_SQL, [uid]))
    .map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  return toCsv(
    ['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'],
    rows
  );
}

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
 *
 * `uid` ist eine LISTE (das Blickfeld, siehe Kommentar unten), nicht eine ID:
 * Das SQL fragt `user_id = ANY($1)`. Und `colorId` kommt als ZEICHENKETTE
 * herein — der einzige Aufrufer ist routes/api_v1/acquisitions.ts und reicht
 * `req.params.colorId` durch, also einen Express-Pfadparameter. Deshalb bleibt
 * das parseInt hier stehen; es ist tragend, nicht Zierde.
 */
async function getPartAcquisitions(uid: number[], partNumber: string, colorId: string | number) {
  // uid ist hier das BLICKFELD (Liste): Im Haushalt können die Kaufpreise
  // eines Teils mehreren Konten gehören, und je Zeile kommt der Eigentümer
  // mit — sonst wüsste die Auswahl im Dialog nicht, worauf sie steht.
  // ── Kein Rueckfall auf die Stammzeile mehr ──────────────────────────────
  //
  // Hier stand COALESCE(a.unit_price, p.unit_price, p.purchase_price) und
  // dazu ein LEFT JOIN auf parts. Beide Spalten hat Migration 0035 geloescht
  // — und der Rueckfall war ohnehin verkehrt herum: Er liess eine Erfassung
  // OHNE Preis den Preis der Stammzeile anzeigen, also den der NEUESTEN
  // Erfassung. Im Kaufpreis-Dialog stand damit an einer leeren Zeile ein
  // Betrag, der zu einer anderen Zeile gehoert.
  //
  // Jetzt zeigt die Erfassung, was in ihr steht. Leer heisst leer.
  return db.all(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition,
            a.created_at, a.user_id AS owner_user_id
     FROM part_acquisitions a
     WHERE a.user_id = ANY($1) AND a.part_number=$2 AND a.color_id=$3
     ORDER BY a.created_at ASC, a.id ASC`,
    [uid, partNumber, parseInt(String(colorId)) || 0]
  );
}

export = Object.assign(router, { fetchMissingBlIds, importPartsForSet, getCurrentPartMarketPrice, addManualPart, updateManualPart, lookupPart, getPartColorList, buildPartsCsv, getPartAcquisitions });
