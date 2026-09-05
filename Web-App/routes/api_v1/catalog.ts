/**
 * /api/v1/catalog — Rebrickable-Katalog (Browsen/Suchen/Filtern aller Sets).
 *
 * Datenquelle sind die täglich per CSV-Sync gefüllten Tabellen rb_sets,
 * rb_themes, rb_inventories und rb_inventory_minifigs — es werden KEINE
 * Rebrickable-API-Calls gemacht, alles kommt aus der lokalen DB.
 *
 * requireToken akzeptiert Session-Cookie (Webapp) UND Bearer-Token (Android),
 * daher reicht ein einziger Router für beide Clients (Muster wie /v1/stats).
 *
 * Endpunkte:
 *   GET /catalog/meta              — Themes (mit Set-Zahl inkl. Unterthemen) + Jahresbereich
 *   GET /catalog/sets              — paginierte Liste; q, theme_id, year_from, year_to, sort, page, limit
 *   GET /catalog/sets/:setNumber   — Detail inkl. Theme-Pfad, Minifiguren-Zahl, Besitz-Status
 */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { resolveIfExists } from '../../utils/images';
import { requireToken } from './middleware';
import { resolveMany, resolveOne, resolveViaApi } from '../../utils/bricklinkLink';
import { downloadSetImage } from '../../utils/setImages';
import { ausTabelle } from '../../utils/validate';
import { neuestesInventar } from '../../utils/rbInventar';
import { mitVersion } from '../../utils/setNummer';
import { sendeFehler } from '../../utils/fehlerTexte';

const router = express.Router();

// ── Die eigene Bild-Warteschlange der Katalogliste ist entfallen ────────────
//
// Marcos Zuordnung: „Die CPU ist seit der Umstellung des Katalogs mit dem
// Scrolling so stark ausgelastet." Damit war die Suche endlich am richtigen
// Ort — hier.
//
// Diese Datei hatte eine EIGENE Warteschlange, die zu jedem gelisteten Set das
// Bild holte und `generateThumb()` DIREKT aufrief. Damit lief sie an allem
// vorbei, was ich in den Nachträgen 99 bis 104 gedrosselt hatte:
//
//   • nicht an THUMB_MAX_PARALLEL — das gilt im Bild-Proxy,
//   • nicht an der Sitzungssperre aus Nachtrag 100 — dito,
//   • und mit eigener Parallelität 2: bei vier Arbeitsprozessen acht
//     gleichzeitige Jimp-Läufe. Das sind die über 300 %.
//
// Ich habe fünf Nachträge lang die Drosselung des einen Erzeugers verfeinert,
// während der zweite ungebremst danebenlief. Gefunden hat ihn Marcos Hinweis,
// WANN es angefangen hat — nicht meine Vermutungen darüber, WAS rechnet.
//
// Vor dem Umbau der Liste fiel er nicht auf: Sie zeigte nur, wozu man sich
// hingescrollt hatte, also ein paar Seiten. Seit dem Fensterladen kommen bei
// jedem Sprung hunderte Sets vorbei.
//
// Gebraucht wird sie nicht mehr: Seit Nachtrag 102 hinterlässt jede Bildanfrage
// über den Proxy eine Notiz, und `jobs/imageQueue.ts` legt Bild UND Vorschau im
// Hintergrund an — gebündelt und nur auf dem Primärprozess.

// ── Theme-Baum-Cache ─────────────────────────────────────────────────────────
// rb_themes ändert sich höchstens einmal täglich (CSV-Sync). Der Baum wird
// pro Prozess 1h gecacht — Pfadnamen ("Star Wars › UCS") und Nachfahren-
// Auflösung für den Filter brauchen ihn bei jedem Request.
type ThemeNode = { id: number; name: string; parent_id: number | null };
let _themeCache: {
  at: number;
  byId: Map<number, ThemeNode>;
  children: Map<number, number[]>;
  pathName: Map<number, string>;
} | null = null;
const THEME_CACHE_TTL = 60 * 60 * 1000;

async function getThemeTree() {
  if (_themeCache && Date.now() - _themeCache.at < THEME_CACHE_TTL) return _themeCache;
  const rows: ThemeNode[] = await db.all('SELECT id, name, parent_id FROM rb_themes');
  const byId = new Map<number, ThemeNode>();
  const children = new Map<number, number[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    if (r.parent_id != null) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id)!.push(r.id);
    }
  }
  // Vollständiger Pfadname je Theme ("Eltern › Kind"), zyklen-sicher.
  const pathName = new Map<number, string>();
  const resolvePath = (id: number, seen: Set<number>): string => {
    const fertig = pathName.get(id);
    if (fertig !== undefined) return fertig;
    const node = byId.get(id);
    if (!node) return '';
    let name = node.name || '';
    if (node.parent_id != null && !seen.has(node.parent_id)) {
      seen.add(id);
      const parent = resolvePath(node.parent_id, seen);
      if (parent) name = `${parent} › ${name}`;
    }
    pathName.set(id, name);
    return name;
  };
  for (const id of byId.keys()) resolvePath(id, new Set([id]));
  _themeCache = { at: Date.now(), byId, children, pathName };
  return _themeCache;
}

/** Alle Nachfahren-IDs eines Themes (inkl. der ID selbst). */
function descendantIds(tree: Awaited<ReturnType<typeof getThemeTree>>, rootId: number): number[] {
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop();
    // while (stack.length) garantiert eine Zahl; der Typ von Array.pop() sagt
    // das nicht, also einmal ausdrücklich statt viermal mit `!`.
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of tree.children.get(id) || []) stack.push(c);
  }
  return out;
}

// ── GET /catalog/meta ────────────────────────────────────────────────────────
router.get('/catalog/meta', requireToken, async (_req: AuthedRequest, res) => {
  try {
    const tree = await getThemeTree();
    const [counts, years, yearCounts] = await Promise.all([
      db.all(`SELECT theme_id, COUNT(*)::int AS n FROM rb_sets GROUP BY theme_id`),
      db.get(`SELECT MIN(year)::int AS year_min, MAX(year)::int AS year_max
              FROM rb_sets WHERE year > 0`),
      // Set-Zahl pro Jahr — für den Jahres-Scrubber (Bubble "1998 · 234 Sets")
      db.all(`SELECT year::int AS year, COUNT(*)::int AS n
              FROM rb_sets WHERE year > 0 GROUP BY year ORDER BY year`),
    ]);
    const direct = new Map<number, number>();
    for (const c of counts) direct.set(c.theme_id, c.n);
    // Set-Zahl inkl. Unterthemen — so zeigt "Star Wars" alle UCS/Episode-Sets mit.
    const themes: any[] = [];
    for (const id of tree.byId.keys()) {
      let total = 0;
      for (const d of descendantIds(tree, id)) total += direct.get(d) || 0;
      if (total > 0) themes.push({ id, name: tree.pathName.get(id) || '', set_count: total });
    }
    themes.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    res.json({
      success: true,
      themes,
      year_min: years?.year_min || null,
      year_max: years?.year_max || null,
      year_counts: yearCounts,
    });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// ── GET /catalog/sets ────────────────────────────────────────────────────────
const SORTS: Record<string, string> = {
  year_desc:  'rb.year DESC, rb.set_num ASC',
  year_asc:   'rb.year ASC, rb.set_num ASC',
  name_asc:   'rb.name ASC, rb.set_num ASC',
  num_asc:    'rb.set_num ASC',
  parts_desc: 'rb.num_parts DESC, rb.set_num ASC',
  parts_asc:  'rb.num_parts ASC, rb.set_num ASC',
};

/**
 * GET /api/v1/catalog/year-verteilung?q=&theme_id=&sort=
 *
 * Wie viele Sets je Jahr — MIT den aktuellen Filtern und in der Reihenfolge der
 * Sortierung.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn dann die Bilder geladen werden, erscheinen sie von einem anderen Jahr
 * als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von 1999
 * geladen, obwohl rechts 1965 steht."
 *
 * Die Ursache war eine Annahme, die niemand ausgesprochen hatte: Das Etikett
 * rechnete die Position LINEAR auf den Jahresbereich um — als läge zwischen
 * 1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der weitaus
 * grösste Teil des Katalogs aus den letzten Jahrzehnten; wer neun Zehntel
 * hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.
 *
 * Mit dieser Verteilung wird aus der Position eine laufende Nummer und daraus
 * das Jahr, in dem diese Nummer wirklich liegt. Die Zahlen kommen vom SERVER,
 * weil nur er die Filter kennt — eine Verteilung ohne Filter läge genauso
 * daneben wie die lineare Schätzung.
 */
router.get('/catalog/year-verteilung', requireToken, async (req: AuthedRequest, res) => {
  try {
    const q       = String(req.query.q || '').trim();
    const themeId = parseInt(String(req.query.theme_id || '')) || null;
    const absteigend = String(req.query.sort || '') !== 'year_asc';

    const themeIds = themeId ? descendantIds(await getThemeTree(), themeId) : null;
    const params: any[] = [];
    const where: string[] = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(rb.set_num ILIKE $${params.length} OR rb.name ILIKE $${params.length})`);
    }
    if (themeIds) { params.push(themeIds); where.push(`rb.theme_id = ANY($${params.length})`); }
    const basis = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // NULL-Jahre sortiert Postgres bei DESC nach vorne — dieselbe Reihenfolge
    // wie die Liste, sonst zeigte das Etikett am oberen Rand daneben.
    const rows = await db.all(
      `SELECT rb.year, COUNT(*)::int AS n FROM rb_sets rb ${basis}
        GROUP BY rb.year
        ORDER BY rb.year ${absteigend ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'}`, params);
    res.json({ success: true, years: rows });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/catalog/sets', requireToken, async (req: AuthedRequest, res) => {
  try {
    const userId   = req.apiUser.user_id;
    const q        = String(req.query.q || '').trim();
    const themeId  = parseInt(String(req.query.theme_id || '')) || null;
    const yearFrom = parseInt(String(req.query.year_from || '')) || null;
    const yearTo   = parseInt(String(req.query.year_to || '')) || null;
    // ausTabelle statt SORTS[…]: Ein direkter Zugriff liefert auch geerbte
    // Eigenschaften, und `|| SORTS.year_desc` faengt die NICHT ab. ?sort=constructor
    // ergab damit `ORDER BY function Object() { [native code] }`. Siehe
    // utils/validate.ausTabelle.
    const sort     = ausTabelle(SORTS, req.query.sort, SORTS.year_desc);
    const page     = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit    = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '60')) || 60));
    const offset   = (page - 1) * limit;

    // WHERE-Klausel einmal definieren und für Count- UND Listen-Query mit
    // jeweils eigener, fortlaufender Platzhalter-Nummerierung aufbauen —
    // vermeidet fehleranfälliges Umnummerieren.
    const themeIds = themeId ? descendantIds(await getThemeTree(), themeId) : null;
    const buildWhere = (params: any[]) => {
      const where: string[] = [];
      if (q) {
        // Suche über Setnummer UND Name; "75192" trifft auch "75192-1".
        params.push(`%${q}%`);
        where.push(`(rb.set_num ILIKE $${params.length} OR rb.name ILIKE $${params.length})`);
      }
      if (themeIds) { params.push(themeIds); where.push(`rb.theme_id = ANY($${params.length})`); }
      if (yearFrom) { params.push(yearFrom); where.push(`rb.year >= $${params.length}`); }
      if (yearTo)   { params.push(yearTo);   where.push(`rb.year <= $${params.length}`); }
      return where.length ? `WHERE ${where.join(' AND ')}` : '';
    };

    const countParams: any[] = [];
    const countWhere = buildWhere(countParams);
    const totalRow = await db.get(
      `SELECT COUNT(*)::int AS n FROM rb_sets rb ${countWhere}`,
      countParams
    );

    const listParams: any[] = [userId]; // $1 = userId (für owned-Join)
    const listWhere = buildWhere(listParams);
    listParams.push(limit);
    const pl = listParams.length;
    listParams.push(offset);
    const po = listParams.length;

    const sets = await db.all(
      `SELECT rb.set_num AS set_number, rb.name, rb.year, rb.theme_id,
              rb.num_parts, rb.set_img_url AS image_url,
              (s.set_number IS NOT NULL) AS owned,
              COALESCE(s.quantity, 0)::int AS owned_quantity
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       ${listWhere}
       ORDER BY ${sort}
       LIMIT $${pl} OFFSET $${po}`,
      listParams
    );

    const tree = await getThemeTree();
    const total = totalRow?.n || 0;

    // image_local mitgeben, wenn die Datei bereits existiert — unabhängig
    // davon, WELCHER Nutzer sie einmal heruntergeladen hat.
    //
    // downloadSetImage() (utils/setImages.ts) legt Set-Bilder unter
    // public/images/sets/<setnummer>.jpg ab, benannt nach der Setnummer
    // allein — die Datei ist von Anfang an nutzerunabhängig, nur die Spalte
    // `image_local` lebt zufällig auf der Pro-Nutzer-Zeile in `sets`. Der
    // Katalog zeigt Sets, die der aktuelle Nutzer NICHT besitzt, aber ein
    // ANDERER Nutzer (oder er selbst bei einem früheren Set) kann dieselbe
    // Bilddatei schon heruntergeladen haben. In dem Fall die lokale Datei
    // servieren statt eine weitere CDN-Anfrage über den Proxy zu machen.
    //
    // resolveIfExists() (utils/images.ts) statt eigener fs-Zugriffe: synchron
    // UND gecacht. Die vorige Fassung fragte bis zu 200 Sets pro Seite
    // gleichzeitig per fs.promises.access() ab — das läuft über den kleinen
    // libuv-Thread-Pool (standardmässig 4 Threads) und flutete ihn, was
    // andere Pool-Arbeit verzögerte (u. a. TLS-Handshakes neuer
    // Datenbank-Verbindungen — sichtbar als "timeout exceeded when trying to
    // connect" beim Filtern nach Jahr, wo viele Treffer auf einmal
    // ausgeliefert werden). Der Cache sorgt dafür, dass ein Set, das schon
    // einmal geprüft wurde, beim nächsten Mal keinen Dateisystem-Zugriff
    // mehr braucht.
    const setsWithLocal = sets.map(s => {
      const safe = String(s.set_number).replace(/[^a-z0-9-]/gi, '_');
      // resolveIfExists() ist synchron und gecacht (utils/images.ts) — kein
      // Promise.all über bis zu 200 gleichzeitige fs-Zugriffe mehr, das den
      // kleinen libuv-Thread-Pool geflutet und (bestätigt im Server-Log)
      // Datenbank-Timeouts ausgelöst hat. Liefert zugleich den
      // Vorschau-Pfad, falls eine "_thumb.jpg" existiert — vorher zeigte der
      // Katalog IMMER die Originalgrösse, weil nur auf das Original geprüft
      // wurde, nie auf die Vorschau.
      const image_local = resolveIfExists(`/images/sets/${safe}.jpg`);
      // Fehlt die Datei noch, geschieht hier NICHTS: Das Bild wird beim
      // Anzeigen über den Proxy geholt, der eine Notiz hinterlässt, und
      // jobs/imageQueue.ts legt es samt Vorschau im Hintergrund ab. Die Liste
      // selbst stösst keine Bildarbeit mehr an (siehe Kopf dieser Datei).
      return { ...s, image_local, theme_name: tree.pathName.get(s.theme_id) || null };
    });

    res.json({
      success: true,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      sets: setsWithLocal,
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /catalog/sets/:setNumber ─────────────────────────────────────────────
router.get('/catalog/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    const userId = req.apiUser.user_id;
    const raw = String(req.params.setNumber || '').trim();
    const n   = mitVersion(raw);

    const set = await db.get(
      `SELECT rb.set_num AS set_number, rb.name, rb.year, rb.theme_id,
              rb.num_parts, rb.set_img_url AS image_url,
              (s.set_number IS NOT NULL) AS owned,
              COALESCE(s.quantity, 0)::int AS owned_quantity
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       WHERE rb.set_num = $2`,
      [userId, n]
    );
    if (!set) { sendeFehler(req, res, 404, 'set_nicht_im_katalog'); return; }

    // Minifiguren-Zahl aus dem neuesten Inventar (analog catalogSync).
    // Vorher nur EIN Kandidat, obwohl der Kommentar darueber schon auf
    // catalogSync verwies — das prueft zwei.
    const invId = await neuestesInventar(n).catch(() => null);
    let minifigCount = 0;
    if (invId) {
      const m = await db.get(
        'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM rb_inventory_minifigs WHERE inventory_id = $1',
        [invId]
      ).catch(() => null);
      minifigCount = m?.n || 0;
    }

    const tree = await getThemeTree();
    // BrickLink-Link kommt vom Server, nicht aus dem Client: Ob eine Nummer
    // dort ein Set, Gear oder ein Buch ist, weiss nur catalog_cache — und die
    // Regel darf nicht in zwei Clients dupliziert werden (siehe
    // utils/bricklinkLink.ts).
    let bricklink = await resolveOne(set.set_number);
    // Noch nie aufgelöst? Einmalig gegen BrickLink prüfen und dauerhaft cachen.
    // Nur hier, auf einer bewusst geöffneten Detailseite — in Listen bleibt es
    // bei der reinen DB-Auflösung.
    if (!bricklink.resolved) bricklink = await resolveViaApi(set.set_number).catch(() => bricklink);

    // Dieselbe Auflösung wie in der Liste: nutzerunabhängige, bereits
    // heruntergeladene Datei bevorzugen statt CDN/Proxy — und die Vorschau,
    // falls sie existiert, nicht immer die Originalgrösse (derselbe Fehler
    // wie in der Liste, siehe resolveIfExists() in utils/images.ts).
    const safe = String(set.set_number).replace(/[^a-z0-9-]/gi, '_');
    let image_local = resolveIfExists(`/images/sets/${safe}.jpg`);

    // Noch nicht heruntergeladen? Jetzt holen und dauerhaft ablegen — nicht
    // nur im Bild-Proxy-Cache zwischenspeichern, der pro angefragter URL
    // lebt und beim Hinzufügen des Sets erneut heruntergeladen würde.
    //
    // Der Detail-Dialog ist ein bewusstes Anschauen (wie bei BrickLink oben)
    // — anders als die Liste, wo Hunderte Kacheln beim Scrollen vorbeiziehen
    // und ein Download pro Kachel den Server unnötig belasten würde. Hier ist
    // GENAU EIN Set gemeint, also genau EIN CDN-Abruf. downloadSetImage()
    // prüft selbst zuerst, ob die Datei schon existiert (idempotent, egal ob
    // schon ein anderer Nutzer sie geholt hat), lädt sie nach
    // public/images/sets/ herunter und stösst über den bestehenden
    // Thumbnail-Mechanismus in server.ts (setImmediate nach dem Download) die
    // Erzeugung der "_thumb.jpg"-Vorschau an. Damit ist jeder folgende
    // Aufruf — auch die Kachel in der Liste — sofort lokal bedient, ohne
    // erneuten CDN-Umweg.
    if (!image_local && set.image_url) {
      image_local = await downloadSetImage(set.image_url, set.set_number).catch(() => null);
      if (image_local) {
        // Vorschau erzeugen — geschieht NICHT innerhalb von downloadSetImage()
        // selbst, sondern muss vom Aufrufer angestossen werden (derselbe
        // Schritt, den addSet() in routes/sets.ts nach einem Download macht).
        // Ohne das läge das Bild zwar dauerhaft ab, bekäme aber nie eine
        // "_thumb.jpg"-Variante, und jede Kachel würde weiterhin die grosse
        // Originaldatei laden.
        // Über den Hintergrund-Job statt direkt (Nachtrag 105): Ein direkter
        // Aufruf liefe wieder an jeder Drosselung vorbei.
        require('../../jobs/imageQueue').merkeGebraucht(String(set.image_url || ''), set.set_number);
      }
    }

    res.json({
      success: true,
      set: { ...set, image_local, theme_name: tree.pathName.get(set.theme_id) || null, minifigs: minifigCount, bricklink },
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/catalog/bricklink?sets=a,b,c ─────────────────────────────────
// Gebündelte BrickLink-Links für eine ganze Katalogseite: EINE SQL-Abfrage
// statt einer pro Set, und kein einziger BrickLink-API-Aufruf.
//
// Gebündelt gegen BrickLink selbst geht nicht — deren Store-API kennt nur
// GET /items/{type}/{no} und drosselt bei ~1 Anfrage/Sekunde. Rebrickable
// wiederum führt external_ids nur bei Parts, nicht bei Sets. Die einzige
// bündelbare Stelle ist deshalb der lokale Cache, und genau die nutzt dieser
// Endpoint.
router.get('/catalog/bricklink', requireToken, async (req: AuthedRequest, res) => {
  try {
    const raw = String(req.query.sets || '').trim();
    if (!raw) { res.json({ success: true, links: {} }); return; }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 500);
    const map = await resolveMany(list);
    res.json({ success: true, links: Object.fromEntries(map) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export = router;
