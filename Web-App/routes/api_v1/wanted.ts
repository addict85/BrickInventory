/**
 * /api/v1/wanted — die Merkliste.
 *
 * Die Regeln stehen in utils/merkliste.ts, nicht hier. Diese Datei tut das,
 * was eine Route tun soll: Blickfeld bestimmen, Schreibrecht prüfen, Fehler
 * übersetzen.
 */
import express from 'express';
import { fehlertext, handleRouteError, logAndContinue, pfadParam } from '../../utils/httpError';
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
import { starteAuftrag, meldeAuftrag, beendeAuftrag, istAbgebrochen } from '../../utils/importAuftrag';

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
  async (req: AuthedRequest & { file?: { buffer: Buffer; originalname?: string } }, res) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    // Vor dem try: Der catch-Zweig muss den Auftrag schliessen können, und
    // was im try entsteht, sieht er nicht.
    const uid = req.apiUser.user_id;
    // ZWEI Merker, und das ist kein Luxus (GEMESSEN):
    //
    //   angefragt — „der Start ist unterwegs". Verhindert, dass die zweite
    //               Fortschrittsmeldung einen zweiten Start auslöst.
    //   laeuft    — „der Auftrag gehört UNS". Erst wenn starteAuftrag das
    //               bestätigt hat.
    //
    // Mit nur einem Merker war beides dasselbe, und der Abschluss unten lief
    // auf dem Merker „angefragt": Der Wanted-Import hat damit den Auftrag
    // eines FREMDEN, laufenden CSV-Imports auf „done" gesetzt — genau das,
    // was er nicht anfassen soll. Der Fall steht als Prüfung in
    // test/wanted-liste-route-db.test.js.
    let auftragAngefragt = false;
    let auftragLaeuft = false;
    // Die Meldungen laufen über eine Kette: Der Rückruf aus dem Kern ist
    // synchron, das Schreiben in die Datenbank ist es nicht. Ohne die Kette
    // überholen sich zwei Meldungen, und im Balken stünde eine kleinere Zahl
    // nach einer grösseren.
    let kette: Promise<unknown> = Promise.resolve();
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

      // ── Der Fortschritt als STROM (Marcos Wunsch vom 20.10.) ────────────
      //
      // „kannst du beim Import auch den Fortschritt mit einem
      //  Fortschrittsbalken anzeigen?"
      //
      // Ohne `strom=1` verhält sich die Route wie bisher: eine Anfrage, eine
      // JSON-Antwort. Das ist der Weg der Android-App und aller Prüfungen, und
      // er bleibt unangetastet.
      //
      // Mit `strom=1` kommen Zeile für Zeile JSON-Objekte (NDJSON): erst die
      // Fortschrittsmeldungen, zuletzt der Bericht. Warum so und nicht als
      // SSE-Auftrag wie beim Set-Import:
      //
      //   • EventSource kann kein POST, und die Datei muss mit. Ein Auftrag
      //     mit eigener Kennung hiesse, die fremde Datei auf dem Server zu
      //     halten, bis jemand den Strom abholt — genau das lehnt der Kopf von
      //     public/js/18-wanted-xml.js ab.
      //   • Eine Antwort, zwei Phasen: Der zweistufige Ablauf (Vorschau,
      //     dann Schreiben) bleibt, wie er ist.
      //
      // res.flush() nach jeder Zeile ist tragend: server.ts hängt compression
      // vor ALLE Antworten (nur text/event-stream ist ausgenommen). Ohne das
      // Durchdrücken sammelt gzip die Zeilen und schickt sie am Ende zusammen
      // — der Balken spränge von 0 auf 100, und zwar genau dann, wenn er nicht
      // mehr gebraucht wird.
      // Was im Balken als „gerade dran" steht. Der CSV-Import zeigt dort die
      // Setnummer; hier gibt es keine einzelne Nummer, die etwas sagt — also
      // der Dateiname, damit in der anderen Sitzung erkennbar ist, WAS läuft.
      const dateiName = String(req.file.originalname || 'wanted.xml').slice(0, 120);
      const strom = String(req.query.strom ?? '') === '1';
      if (strom) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        // Für Proxys, die ihrerseits puffern (nginx & Verwandte).
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }
      /** Eine Zeile in den Strom. Ohne Strom: nichts. */
      const schreibeZeile = (o: unknown) => {
        if (!strom || res.writableEnded) return;
        res.write(JSON.stringify(o) + '\n');
        (res as unknown as { flush?: () => void }).flush?.();
      };

      // ── Derselbe Balken wie beim Set-Import (Marcos Wunsch vom 20.10.) ──
      //
      // „bitte auch noch umsetzen, dass der Import der BL-XML Importe in der
      //  Android-App angezeigt werden (analog den Set-Importen)."
      //
      // Der Strom oben versorgt den Tab, der die Datei geschickt hat. Der
      // Auftragsdatensatz hier versorgt ALLE ANDEREN: die Android-App zeigt
      // ihren Balken auf jedem Reiter, die Webapp ihren im Kopf, und auch eine
      // zweite Browser-Sitzung desselben Kontos sieht ihn — der Datensatz
      // hängt am Konto, nicht an dieser Anfrage (utils/importAuftrag.ts).
      //
      // NUR beim echten Schreiben: Eine Vorschau ändert nichts, und ein
      // Balken „Import läuft" für eine Vorschau wäre eine Lüge in drei
      // Oberflächen gleichzeitig.
      const schreiben = String(req.query.schreiben ?? '') === '1';
      const anDenAuftrag = (stand: { fertig: number; gesamt: number }, unbedingt = false) => {
        if (!auftragLaeuft) return;
        kette = kette
          .then(() => meldeAuftrag(uid, { done: stand.fertig, total: stand.gesamt }, unbedingt))
          .catch(logAndContinue('wanted-import:auftrag'));
      };

      const bericht = await importiereWantedListe(uid, xml, {
        // Geschrieben wird nur, wenn es ausdrücklich dasteht.
        vorschau: !schreiben,
        ueberRebrickable: String(req.query.rebrickable ?? '') === '1',
        ...(korrekturen ? { korrekturen } : {}),
        // Eine von Hand eingetragene Nummer wird gemerkt — Begründung an der
        // Aufrufstelle in utils/wantedListe.ts.
        merkeNummer: (art, rbId, blId) => merkeBlNummer(art, rbId, blId),
        // Nur wenn jemand zusieht: Ohne Strom ist der Rückruf gar nicht
        // gesetzt, und der Kern spart sich das Zusammenbauen der Meldungen.
        //
        // EIN Rückruf, zwei Empfänger: der Strom für den eigenen Tab, der
        // Auftragsdatensatz für alle anderen Sitzungen. Zwei getrennte
        // Rückrufe wären zwei Zählungen, die auseinanderlaufen können.
        fortschritt: (stand) => {
          schreibeZeile({ fortschritt: stand });
          // Der Auftrag wird beim ERSTEN Fortschritt angelegt: Vorher ist die
          // Zahl der Posten nicht bekannt, und ein Balken ohne Nenner steht
          // bei 0 %, bis die Datei gelesen ist.
          if (schreiben && !auftragAngefragt && stand.phase === 'schreiben') {
            auftragAngefragt = true;
            kette = kette
              .then(async () => {
                auftragLaeuft = await starteAuftrag(uid, {
                  total: stand.gesamt, current: dateiName,
                });
              })
              .catch((e) => { auftragLaeuft = false; logAndContinue('wanted-import:auftrag')(e); });
          }
          anDenAuftrag(stand);
        },
        // Abbrechen über den Balken — siehe die Begründung an `abbruch`.
        ...(schreiben ? { abbruch: async () => auftragLaeuft && await istAbgebrochen(uid) } : {}),
        anleger: {
          teil:  (u, body) => addManualPart(u, body),
          figur: (u, body) => addManualFig(u, body),
          // addSet nimmt die Setnummer zuerst und erwartet dazu einen
          // Fortschrittsmelder (hier null: niemand sieht zu) und einen
          // Kaufpreis (hier null — MAXPRICE ist eine Suchgrenze).
          set:   (u, sn, menge, zustand) => addSet(sn, menge, u, null, null, zustand),
        },
      });
      // Den Auftrag schliessen, bevor geantwortet wird: Sonst steht der Balken
      // in den anderen Sitzungen noch auf „läuft", während dieser Tab längst
      // den Bericht zeigt.
      // ERST die Kette abwarten, DANN fragen, ob der Auftrag uns gehört: Der
      // Start läuft in der Kette, und vorher steht in `auftragLaeuft` noch
      // nichts Belastbares.
      await kette.catch(() => {});
      if (auftragLaeuft) {
        await beendeAuftrag(uid, {
          ok: bericht.angelegt + bericht.aufgestockt,
          // Offen gebliebene Posten sind weder angelegt noch gescheitert —
          // der Balken führt sie als Anmerkung (⚠), so wie der CSV-Import
          // eine Zeitüberschreitung.
          warn: bericht.posten.filter(p => p.ausgang === 'offen').length,
          fehler: bericht.fehler,
          // Die BEARBEITETEN Posten, nicht die geschriebenen: Sonst bliebe der
          // Balken bei einer Liste mit offenen Posten vor dem Ende stehen.
          done: bericht.posten.length,
          abgebrochen: !!bericht.abgebrochen,
        }).catch(logAndContinue('wanted-import:auftrag-ende'));
      }
      if (strom) {
        // Die LETZTE Zeile ist der Bericht — dieselbe Nutzlast wie ohne Strom,
        // damit beide Wege dasselbe liefern und der Client nur eine Form kennt.
        schreibeZeile({ success: true, ...bericht });
        return res.end();
      }
      res.json({ success: true, ...bericht });
    } catch (e) {
      // Der Auftrag MUSS zu sein, auch wenn der Import geworfen hat. Bliebe er
      // auf „läuft", zeigte der Balken in der App und in jeder anderen Sitzung
      // einen Import, den es nicht mehr gibt — bis jemand einen neuen startet.
      await kette.catch(() => {});
      if (auftragLaeuft) {
        await beendeAuftrag(uid, { ok: 0, fehler: 0, done: 0, abgebrochen: true })
          .catch(logAndContinue('wanted-import:auftrag-ende (Fehler)'));
      }
      // Ist der Strom schon offen, sind die Kopfzeilen raus: Ein Statuscode
      // geht nicht mehr. Dann muss der Fehler als letzte ZEILE kommen, sonst
      // endet die Leitung stumm und der Client wartet auf einen Bericht, der
      // nie kommt.
      if (res.headersSent && !res.writableEnded) {
        res.write(JSON.stringify({ success: false, error: fehlertext(e) }) + '\n');
        return res.end();
      }
      handleRouteError(res, e, undefined, req);
    }
  });

export default router;
