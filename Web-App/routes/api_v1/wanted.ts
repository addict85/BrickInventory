/**
 * /api/v1/wanted — die Merkliste.
 *
 * Die Regeln stehen in utils/merkliste.ts, nicht hier. Diese Datei tut das,
 * was eine Route tun soll: Blickfeld bestimmen, Schreibrecht prüfen, Fehler
 * übersetzen.
 */
import express from 'express';
import { handleRouteError, pfadParam } from '../../utils/httpError';
import { sendeFehler } from '../../utils/fehlerTexte';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { legeMerkpostenAn, loescheMerkposten, verschiebeMerkposten, uebernimm, merkpostenVon } from '../../utils/merkliste';
import { getSetting } from '../../utils/settings';
import { fetchPrice } from '../../utils/financeCalc';
import { csvEmpfang } from '../../utils/dateiEmpfang';
import { csvZeilenAusAnfrage, csvImportAntwort, parseCsvDate } from '../../utils/csvExport';
import { importiereWantedListe } from '../../utils/wantedListe';
import type { Korrektur } from '../../utils/wantedListe';
import { merkeBlNummer } from '../../utils/blZuordnung';
import { baueWantedXmlStuecke, teileZuXmlPosten, uebersetzeFarben } from '../../utils/wantedListeSchreiben';
import type { XmlPosten } from '../../utils/wantedListeSchreiben';
import { getParts } from '../../utils/handlers/parts';
import { getMinifigs } from '../../utils/handlers/minifigs';
import { getSets } from '../../utils/handlers/sets';

const router = express.Router();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/**
 * Die Liste des Blickfelds.
 *
 * Marcos Festlegung: Der Kontenbaum gilt wie überall — der Grossvater sieht
 * die Merkposten der Enkel. Hier ist das nicht nur konsequent, sondern der
 * Zweck: Wer ein Geschenk sucht, schaut genau dort nach.
 *
 * ── Der Filter (Marcos Vorgabe vom 24.09.) ─────────────────────────────────
 *
 *   „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
 *    Inhaber."
 *
 * Dieselben vier Parameter wie bei /v1/sets und in derselben Schreibweise:
 * `search`, `sort`, `accounts` — dazu `condition`, das dort die Zustandsspalte
 * meint und hier den Zustand des Merkpostens.
 *
 * Der INHABER ist `accounts`: Er war hier schon immer vorgesehen, nur hatte
 * ihn keine der beiden Oberflächen je geschickt. Die Übersetzung von „own",
 * „subs" oder einer Konto-ID auf die Liste der IDs macht scopeIds() — eine
 * Stelle für den ganzen Baum.
 *
 * Gefiltert wird am SERVER und nicht in den Oberflächen. Das ist hier nicht
 * wegen der Menge nötig (eine Merkliste hat ein paar Dutzend Einträge),
 * sondern damit beide Oberflächen dasselbe Ergebnis zeigen: Die Sortierung
 * nach Marktpreis etwa braucht price_cache, und den kennt kein Client.
 */
router.get('/wanted', requireToken, async (req: AuthedRequest, res) => {
  try {
    const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    // Die Waehrung des LESERS: Der Marktpreis in der Liste steht in der
    // Waehrung, in der er alles andere sieht. price_cache ist je Waehrung
    // verschluesselt, deshalb gehoert sie in die Abfrage und nicht daneben.
    const waehrung = await getSetting(req.apiUser.user_id, 'currency', 'EUR');
    const merkposten = await merkpostenVon(ids, undefined, waehrung, {
      suche:      req.query.search,
      zustand:    req.query.condition,
      sortierung: req.query.sort,
    });
    res.json({ success: true, merkposten });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Einen Merkposten eintragen — aus dem Katalog-Detail, per Setnummer oder per
 * Barcode. Alle drei Wege landen hier; die Clients unterscheiden sich nur
 * darin, woher die Nummer kommt.
 *
 * owner_user_id wie beim Erfassen eines Sets: Der Grossvater trägt einen
 * Merkposten für den Enkel ein. resolveWriteTarget prüft die RICHTUNG, nicht bloss
 * die Mitgliedschaft im Blickfeld — sonst könnte der Enkel für den Grossvater
 * schreiben.
 */
router.post('/wanted', requireToken, async (req: AuthedRequest, res) => {
  const { set_number, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const { merkposten, war_neu } = await legeMerkpostenAn(owner, set_number, condition);
    res.json({ success: true, war_neu, merkposten });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Den Inhaber eines Merkpostens aendern.
 *
 * Marcos Befund: „Auf dem Detail-Dialog der Merkliste kann der Inhaber
 * nicht geaendert werden." Stimmt — waehlbar war er nur beim Erfassen.
 *
 * ── Warum ZWEI Kontenpruefungen ────────────────────────────────────────────
 *
 * Verschieben heisst hier: aus einem Konto heraus UND in ein anderes hinein.
 * Beide Richtungen muessen erlaubt sein, sonst schoebe ein Enkel den Merkposten
 * des Grossvaters zu sich — oder seinen eigenen dorthin, wo er nichts zu
 * schreiben hat. resolveWriteTarget() prueft genau diese Richtung.
 *
 * Die Regel selbst steht in utils/merkliste.ts (verschiebeMerkposten): Das
 * Aufnahmedatum bleibt, der Preisalarm zieht mit, und ein Merkposten, den das
 * Zielkonto schon hat, wird zusammengefuehrt statt verdoppelt.
 */
router.put('/wanted/:setNumber/:condition/inhaber', requireToken, async (req: AuthedRequest, res) => {
  try {
    const von = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    const zu  = await resolveWriteTarget(req.apiUser.user_id, req.body?.neuer_inhaber);
    if (von === null || zu === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const r = await verschiebeMerkposten(von, pfadParam(req, 'setNumber'),
                                     pfadParam(req, 'condition'), zu);
    res.json({ success: true, ...r, owner_user_id: zu });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Merkposten entfernen.
 *
 * Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Wer sich dasselbe
 * Set neu UND gebraucht wünscht, hat zwei Einträge, und „lösch den Merkposten auf
 * 75192" wäre mehrdeutig.
 */
router.delete('/wanted/:setNumber/:condition', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.query.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const weg = await loescheMerkposten(owner, pfadParam(req, 'setNumber'), pfadParam(req, 'condition'));
    res.json({ success: true, geloescht: weg });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Die Marktpreise eines Merkpostens — BEIDE Zustände, frisch geholt.
 *
 * ── Warum es diese Route gibt ──────────────────────────────────────────────
 *
 * Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?"
 *
 * Weil bisher niemand sie holte. /sets/:sn/price-history LIEST nur den Cache,
 * und in den schrieb bis zu dieser Änderung allein der Preislauf — der kannte
 * `sets` und `price_alerts`, aber nicht die Merkliste. Ein Merkposten ohne
 * Preisalarm hatte deshalb NIE einen Preis.
 *
 * /sets/:sn/price wäre der fertige Weg gewesen, antwortet aber mit 404, wenn
 * einem das Set nicht gehört — für einen Merkposten also ausgeschlossen.
 *
 * ── Warum beide Zustände ───────────────────────────────────────────────────
 *
 * Weil das Set-Detail sie ebenfalls beide zeigt: Wer auf ein gebrauchtes
 * wartet, will trotzdem wissen, was ein neues kostet. Die Antwort trägt
 * deshalb dieselbe Form wie `current` in /price-history — die Oberflächen
 * zeichnen sie mit derselben Funktion.
 *
 * ── Was sie NICHT tut ──────────────────────────────────────────────────────
 *
 * Sie fragt nicht bei jedem Öffnen bei BrickLink an: fetchPrice() bedient
 * sich am Cache, solange dessen Alter unter price_cache_ttl liegt. Der erste
 * Aufruf für ein Set kostet zwei Abrufe, die folgenden keinen.
 */
router.get('/wanted/:setNumber/preise', requireToken, async (req: AuthedRequest, res) => {
  const sn = pfadParam(req, 'setNumber');
  try {
    const uid = req.apiUser.user_id;
    const currency  = await getSetting(uid, 'currency', 'EUR');
    const guideType = await getSetting(uid, 'price_guide_type', 'sold');
    const ttlHours  = await getSetting(uid, 'price_cache_ttl', '24');
    const current: Record<string, unknown> = {};
    for (const c of ['N', 'U']) {
      // Einzeln gefangen: Fuer ein Set, das BrickLink nicht kennt, soll der
      // ANDERE Zustand trotzdem ankommen — und ein fehlender Preis ist kein
      // Fehler, sondern ein Strich in der Anzeige.
      try {
        const pd = await fetchPrice(sn, c, guideType, currency, ttlHours);
        current[c] = { condition: c, avg_price: pd.avg_price,
                       min_price: pd.min_price, max_price: pd.max_price };
      } catch { /* kein Preis fuer diesen Zustand */ }
    }
    res.json({ success: true, set_number: sn, currency, current });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Den Merkposten in die Galerie übernehmen.
 *
 * Die Regel steht in utils/merkliste.ts:uebernimm() — sie ruft addSet(),
 * die eine Wahrheit fürs Erfassen, und räumt danach Eintrag und Preisalarm
 * weg (Marcos Festlegung). Hier bleibt nur, wer schreiben darf.
 */
router.post('/wanted/:setNumber/:condition/uebernehmen', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const r = await uebernimm(req.apiUser.user_id, owner,
      pfadParam(req, 'setNumber'), pfadParam(req, 'condition'), req.body ?? {});
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/wanted/import/csv — eine Merkliste einlesen ────────────────
/**
 * Merkliste aus CSV — das Gegenstück zu buildMerklisteCsv().
 *
 * ── Warum hier und nicht in routes/ wie die anderen drei ────────────────────
 *
 * Sets, Teile und Minifiguren importieren in routes/sets|parts|minifigs.ts —
 * den alten Routern, die nur die Webapp bedient. Die Merkliste hat solche
 * Router nie gehabt: Sie lebt vollständig in dieser Datei und wird von BEIDEN
 * Oberflächen über denselben Weg bedient. Der Import hier zu bauen heisst
 * deshalb, dass die App ihn ohne weiteres Zutun auch hat — und nicht, dass es
 * ihn demnächst zweimal gibt.
 *
 * ── Spaltennamen ────────────────────────────────────────────────────────────
 *
 * Erkannt werden die eigenen (set_number, condition, created_at) UND die
 * deutschen Überschriften, die ein Tabellenprogramm hinterlässt. Dieselbe
 * Nachsicht wie beim Teile- und Minifiguren-Import, aus demselben Grund: Die
 * Datei kommt aus Excel zurück, nicht aus dem Export.
 *
 * Fehlt der Zustand, entscheidet NICHT diese Route, sondern zustandOder() in
 * utils/merkliste.ts — also die Einstellung des Kontos. Eine Vorgabe 'N' hier
 * wäre eine zweite Wahrheit über denselben Standardwert.
 *
 * ── Das Datum durch parseCsvDate ────────────────────────────────────────────
 *
 * Nicht roh weitergegeben: Postgres liest bei DateStyle MDY „01.02.2026" als
 * 2. Januar, ohne Fehler zu melden. Der Fehler ist in diesem Baum schon
 * dreimal aufgetreten (siehe csvGemeinsameFelder); hier steht er nicht noch
 * einmal.
 *
 * ── Wessen Liste ────────────────────────────────────────────────────────────
 *
 * `owner` wie bei POST /wanted: Der Grossvater stellt die Liste des Enkels
 * wieder her. resolveWriteTarget prüft die RICHTUNG — ohne das schriebe ein
 * Unterkonto mit einer hochgeladenen Datei in jedes Konto des Haushalts.
 */
router.post('/wanted/import/csv', requireToken, csvEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer } }, res) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    try {
      const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
      if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');

      const { records, bereinigt, uebersprungen } =
        csvZeilenAusAnfrage(req.file.buffer.toString('utf-8'));

      let added = 0, updated = 0, errors = 0;
      const results: any[] = [];

      for (const row of bereinigt) {
        // Object.values(row)[0] als letzter Rueckfall: eine Datei ohne
        // Kopfzeile, bei der die erste Spalte die Setnummer ist. Dieselbe
        // Nachsicht wie beim Minifiguren-Import.
        const setNumber = String(row.set_number || row['Setnummer'] || row['set_num']
                                 || Object.values(row)[0] || '').trim();
        if (!setNumber) continue;

        const condition = String(row.condition || row['zustand'] || row['Zustand'] || '').trim();
        const am = parseCsvDate(row.created_at || row['aufgenommen_am'] || row['Auf der Liste seit']);

        try {
          const { war_neu } = await legeMerkpostenAn(owner, setNumber, condition, am);
          if (war_neu) { added++; results.push({ set_number: setNumber, action: 'added' }); }
          else         { updated++; results.push({ set_number: setNumber, action: 'exists' }); }
        } catch (e: any) {
          errors++;
          results.push({ set_number: setNumber, action: 'error', error: e?.message });
        }
      }

      csvImportAntwort(res, { added, updated, errors, records, results, uebersprungen });
    } catch (e) { handleRouteError(res, e, undefined, req); }
  });

// ── POST /api/v1/wanted-list/import/xml — BrickLink-Wanted-Liste ────────────
/**
 * Marcos vierter Punkt.
 *
 * ── Die Vorschau ist die VORGABE ───────────────────────────────────────────
 *
 * Ohne `schreiben=1` wird NICHTS angelegt. Das ist nicht Vorsicht um ihrer
 * selbst willen: Die Abbildung BrickLink → Rebrickable hat drei
 * Sicherheitsstufen (siehe utils/wantedListe.ts), und die dritte ist eine
 * Vermutung. Wer 224 Posten hochlädt, soll vorher lesen, wie viele davon auf
 * einer Vermutung beruhen und wie viele offen bleiben — und dann entscheiden.
 *
 * Ein Import, der sofort schreibt, nimmt diese Entscheidung weg, und
 * rückgängig machen hiesse 224 Teile von Hand löschen.
 *
 * ── Rebrickable nur auf Verlangen ──────────────────────────────────────────
 *
 * `rebrickable=1` fragt die OFFENEN Posten bei Rebrickable nach. Jeder Abruf
 * kostet aus dem Tageskontingent, deshalb nicht von selbst. Marcos Vorgabe:
 * „Zuerst die restlichen … mit der OPTION diese über Bricklink oder noch
 * besser über Rebrickable versuchen aufzulösen."
 *
 * ── Das eigene Konto ───────────────────────────────────────────────────────
 *
 * Kein owner-Parameter: Der Import legt Bestand an, und `addManualPart` &
 * Co. schreiben in das Konto, das sie bekommen. Ein owner hier bräuchte
 * resolveWriteTarget und wäre eine Erweiterung, die niemand verlangt hat —
 * bis dahin ist das eigene Konto die einzige Antwort, die nicht überrascht.
 */
router.post('/wanted-list/import/xml', requireToken, csvEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer } }, res) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    try {
      const xml = req.file.buffer.toString('utf-8');
      // Eine Datei, die kein <INVENTORY> trägt, ist keine Wanted-Liste. Das
      // vor dem Zerlegen zu sagen ist eine bessere Auskunft als „0 Posten
      // gelesen" — denn das kann auch eine LEERE Liste sein.
      if (!/<INVENTORY[\s>]/i.test(xml))
        return sendeFehler(req, res, 422, 'keine_wanted_liste');

      // ── Die Anleger gibt DIESE Schicht herein ─────────────────────────────
      //
      // utils/wantedListe.ts darf nicht aus routes/ einfuehren
      // (test/schichten.test.js, Ausnahmeliste leer). Hier ist der Ort, der
      // beide Seiten kennen darf: eine Route, die andere Routen kennt.
      //
      // Dieselben drei Funktionen, die auch die Formulare benutzen — kein
      // eigenes INSERT, denn daran haengen Lagerort, Preisregel,
      // Katalognachtrag und die Erfassungszeile.
      const { addManualPart } = require('../parts');
      const { addManualFig } = require('../minifigs');
      const { addSet } = require('../../utils/setService');
      // ── Korrekturen aus der Vorschau ──────────────────────────────────────
      //
      // Als FELD der Multipart-Anfrage und nicht als Abfrageparameter: Bei 224
      // Posten wäre die Adresse länger als jeder Proxy durchlässt — dieselbe
      // Begründung wie bei POST /parts/owned.
      //
      // JSON.parse in try/catch, und ein Fehlschlag ist eine ABSAGE statt
      // eines stillen „keine Korrekturen": Wer korrigiert hat und dann den
      // Bestand ohne seine Korrekturen bekommt, merkt es erst an den Karten.
      let korrekturen: Korrektur[] | undefined;
      const rohKorr = (req.body as { korrekturen?: unknown } | undefined)?.korrekturen;
      if (typeof rohKorr === 'string' && rohKorr.trim() !== '') {
        let geparst: unknown;
        try { geparst = JSON.parse(rohKorr); }
        catch { return sendeFehler(req, res, 400, 'korrekturen_ungueltig'); }
        if (!Array.isArray(geparst)) return sendeFehler(req, res, 400, 'korrekturen_ungueltig');
        korrekturen = geparst as Korrektur[];
      }

      const bericht = await importiereWantedListe(req.apiUser.user_id, xml, {
        // Geschrieben wird nur, wenn es ausdrücklich dasteht.
        vorschau: String(req.query.schreiben ?? '') !== '1',
        ueberRebrickable: String(req.query.rebrickable ?? '') === '1',
        ...(korrekturen ? { korrekturen } : {}),
        // Eine von Hand eingetragene Nummer wird gemerkt — Begründung an der
        // Aufrufstelle in utils/wantedListe.ts.
        merkeNummer: (art, rbId, blId) => merkeBlNummer(art, rbId, blId),
        anleger: {
          teil:  (u, body) => addManualPart(u, body),
          figur: (u, body) => addManualFig(u, body),
          // addSet nimmt die Setnummer zuerst und erwartet dazu einen
          // Fortschrittsmelder (hier null: niemand sieht zu) und einen
          // Kaufpreis (hier null — MAXPRICE ist eine Suchgrenze).
          set:   (u, sn, menge, zustand) => addSet(sn, menge, u, null, null, zustand),
        },
      });
      res.json({ success: true, ...bericht });
    } catch (e) { handleRouteError(res, e, undefined, req); }
  });

/**
 * POST /api/v1/wanted-list/export/xml — aus dem Bestand eine Wanted-Liste.
 *
 * ── Marcos Frage, und die Antwort darauf ────────────────────────────────────
 *
 *   „oder aus den Teileliste direkt die Teile in eine existierende oder neue
 *    wanted list exportiert werden können"
 *
 * Direkt in seine Liste schreiben kann niemand: Die BrickLink-Store-API hat
 * keine Wanted-Listen-Endpunkte (die Prüfung steht im Kopf von
 * utils/wantedListeSchreiben.ts). Der dokumentierte Weg ist BrickLinks
 * Massen-Upload, und der nimmt genau das XML, das hier entsteht — mit
 * `WANTEDLISTID` für „in DIESE bestehende Liste".
 *
 * ── Warum POST, obwohl nichts geändert wird ─────────────────────────────────
 *
 * Zwei Gründe, und beide hängen zusammen. Erstens kommt eine Antwort heraus,
 * die mehr ist als eine Datei: die Posten, die NICHT mitkonnten. Ein
 * Download kann die nicht nebenbei melden, und eine Wanted-Liste, in der 40
 * Teile stillschweigend fehlen, ist schlimmer als keine. Zweitens reisen
 * dieselben Filter mit wie bei der Liste selbst — wer nach Lagerort und
 * Suchtext filtert, hat sie als Nutzlast, nicht in der Adresse (dieselbe
 * Begründung wie bei POST /parts/owned).
 *
 * ── Dieselben Filter wie die Liste ──────────────────────────────────────────
 *
 * `filter` wird 1:1 an getParts/getMinifigs/getSets weitergegeben. Damit
 * exportiert Marco, was er vor sich sieht — und nicht eine zweite,
 * ähnliche Menge.
 */
router.post('/wanted-list/export/xml', requireToken, async (req: AuthedRequest, res) => {
  try {
    const art = String((req.body as { art?: unknown })?.art ?? 'part');
    if (art !== 'part' && art !== 'fig' && art !== 'set')
      return sendeFehler(req, res, 400, 'art_ungueltig');
    const koerper = (req.body ?? {}) as {
      wanted_list_id?: unknown; filter?: Record<string, unknown>; mit_lagerort?: unknown;
    };
    // BrickLink nimmt die Nummer als Text in <WANTEDLISTID>. Geprüft wird nur
    // die Form (Ziffern), nicht die Existenz — die kennt nur BrickLink, und
    // eine falsche Nummer meldet der Upload dort.
    const listeRoh = String(koerper.wanted_list_id ?? '').trim();
    if (listeRoh !== '' && !/^\d{1,12}$/.test(listeRoh))
      return sendeFehler(req, res, 400, 'wanted_list_id_ungueltig');
    const wantedListId = listeRoh || null;

    const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    // page_size NICHT gesetzt: Dann gilt UNPAGED_LIMIT, und das ist für einen
    // Export die richtige Grenze — er soll alles mitnehmen, was die Liste
    // zeigt, und nicht die erste Seite.
    const filter = { ...(koerper.filter ?? {}), page: 1, page_size: null };

    let posten: XmlPosten[];
    if (art === 'part') {
      const r = await getParts(ids, filter);
      posten = teileZuXmlPosten(r.parts ?? [], { mitLagerort: koerper.mit_lagerort === true });
    } else if (art === 'fig') {
      const r = await getMinifigs(ids, filter);
      // `bl_fig_number` ist die BrickLink-Nummer aus der Zuordnung; ohne
      // Eintrag ist sie die Rebrickable-Nummer (COALESCE in blNummerSql).
      // Eine Figur hat keine Farbe — deshalb blFarbe: null.
      posten = (r.figs ?? []).map((f: { bl_fig_number?: string; fig_number: string;
                                        quantity?: number }) => ({
        art: 'fig' as const,
        blId: String(f.bl_fig_number || f.fig_number),
        blFarbe: null,
        menge: Number(f.quantity ?? 1) || 1,
      }));
    } else {
      const r = await getSets(ids, filter);
      // Setnummern sind bei BrickLink dieselben wie bei Rebrickable — die
      // Notiz dazu steht an BlArt in utils/blZuordnung.ts („GEMESSEN hat kein
      // Set irgendwo eine eigene BrickLink-Nummer").
      posten = (r.sets ?? []).map((x: { set_number: string; quantity?: number }) => ({
        art: 'set' as const,
        blId: String(x.set_number),
        blFarbe: null,
        menge: Number(x.quantity ?? 1) || 1,
      }));
    }

    const { posten: fertig, ohneFarbe } = await uebersetzeFarben(posten);
    const stuecke = baueWantedXmlStuecke(fertig, wantedListId);
    res.json({
      success: true,
      art,
      wanted_list_id: wantedListId,
      enthalten: fertig.length,
      ohne_farbe: ohneFarbe,
      // Die Stücke EINZELN: BrickLink nimmt höchstens 204 800 Bytes je
      // Upload, und eine Datei, die darüber liegt, lehnt es wortlos ab.
      //
      // Die GRENZE selbst reist NICHT mit. Sie stand hier als `max_bytes` und
      // hatte keinen Verbraucher — test/antwortfelder.test.js hat es gemeldet,
      // und mit Recht: Geschnitten wird auf dem Server, der Client zählt
      // nichts nach. Ein Feld, das niemand liest, sieht aus wie eine Zusage.
      stuecke,
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
