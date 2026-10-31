/**
 * /api/v1/wanted — die Merkliste.
 *
 * Die Regeln stehen in src/merkliste/merkliste.ts, nicht hier. Diese Datei tut das,
 * was eine Route tun soll: Blickfeld bestimmen, Schreibrecht prüfen, Fehler
 * übersetzen.
 */
import express from 'express';
import { fehlertext, handleRouteError, logAndContinue, pfadParam } from '../../src/infra/httpError';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { legeMerkpostenAn, loescheMerkposten, verschiebeMerkposten, uebernimm, merkpostenVon } from '../../src/merkliste/merkliste';
import { getSetting } from '../../src/konto/settings';
import { fetchPrice } from '../../src/finanzen/financeCalc';
import { csvEmpfang, xmlEmpfang } from '../../src/infra/dateiEmpfang';
import { csvZeilenAusAnfrage, csvImportAntwort, parseCsvDate } from '../../src/infra/csvExport';
import { importiereWantedListe } from '../../src/merkliste/wantedListe';
import type { Korrektur } from '../../src/merkliste/wantedListe';
import { merkeBlNummer } from '../../src/katalog/blZuordnung';
import { starteAuftrag, meldeAuftrag, beendeAuftrag, istAbgebrochen } from '../../src/auftraege/importAuftrag';
import { addManualPart } from '../../src/teile/manuelleTeile';
import { addManualFig } from '../../src/figuren/manuelleFiguren';
import { addSet } from '../../src/sets/setService';

const router = express.Router();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/**
 * Die Liste des Blickfelds.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted
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
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted
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
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#put-wanted-setnumber-condition-inhaber
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
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted-setnumber-preise
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
 * Die Regel steht in src/merkliste/merkliste.ts:uebernimm() — sie ruft addSet(),
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
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-import-csv
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
 * Die Vorschau ist die VORGABE
 * Ohne `schreiben=1` wird NICHTS angelegt. Das ist nicht Vorsicht um ihrer
 * selbst willen: Die Abbildung BrickLink → Rebrickable hat drei
 * Sicherheitsstufen (siehe src/merkliste/wantedListe.ts), und die dritte ist eine …
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml
 */
router.post('/wanted-list/import/xml', requireToken, xmlEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer; originalname?: string } }, res) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    // Vor dem try: Der catch-Zweig muss den Auftrag schliessen können, und
    // was im try entsteht, sieht er nicht.
    const uid = req.apiUser.user_id;
    // ZWEI Merker, und das ist kein Luxus (GEMESSEN):
    // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-auftragangefragt
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

      // Die Anleger gibt diese Schicht herein, damit src/merkliste/wantedListe.ts sie
      // in Tests ersetzen kann.
      // Korrekturen aus der Vorschau
      // Als FELD der Multipart-Anfrage und nicht als Abfrageparameter: Bei 224
      // Posten wäre die Adresse länger als jeder Proxy durchlässt — dieselbe
      // Begründung wie bei POST /parts/owned.
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-korrekturen
      let korrekturen: Korrektur[] | undefined;
      const rohKorr = (req.body as { korrekturen?: unknown } | undefined)?.korrekturen;
      if (typeof rohKorr === 'string' && rohKorr.trim() !== '') {
        let geparst: unknown;
        try { geparst = JSON.parse(rohKorr); }
        catch { return sendeFehler(req, res, 400, 'korrekturen_ungueltig'); }
        if (!Array.isArray(geparst)) return sendeFehler(req, res, 400, 'korrekturen_ungueltig');
        korrekturen = geparst as Korrektur[];
      }

      // Der Fortschritt als STROM
      // Ohne `strom=1` verhält sich die Route wie bisher: eine Anfrage, eine
      // JSON-Antwort. Das ist der Weg der Android-App und aller Prüfungen, und
      // er bleibt unangetastet.
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-dateiname
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

      // Derselbe Balken wie beim Set-Import
      // Der Strom oben versorgt den Tab, der die Datei geschickt hat. Der
      // Auftragsdatensatz hier versorgt ALLE ANDEREN: die Android-App zeigt
      // ihren Balken auf jedem Reiter, die Webapp ihren im Kopf, und auch eine …
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-schreiben
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
        // Aufrufstelle in src/merkliste/wantedListe.ts.
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
          // Kaufpreis. Der ist seit dem 21.10. MAXPRICE aus der Datei —
          // Marcos Entscheidung; die Begründung samt der alten, falschen …
          // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-3
          set:   (u, sn, menge, zustand, kaufpreis) =>
                   addSet(sn, menge, u, null, kaufpreis, zustand),
        },
      });
      // Den Auftrag schliessen, bevor geantwortet wird: Sonst steht der Balken
      // in den anderen Sitzungen noch auf „läuft", während dieser Tab längst
      // den Bericht zeigt.
      // ERST die Kette abwarten, DANN fragen, ob der Auftrag uns gehört: Der …
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-4
      await kette;
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
        },
        // Je Posten eine echte Zeile fürs Protokoll des Balkens — Marcos
        // Befund vom 21.10. („ganz viele Zeilen mit Undefined - aktualisiert").
        // Die Begründung steht bei beendeAuftrag; hier nur, WAS drinsteht:
        // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-5
        bericht.posten.map(p => {
          if (p.ausgang === 'angelegt' || p.ausgang === 'aufgestockt') {
            return { success: true, set_number: p.blId,
                     action: p.ausgang === 'angelegt' ? 'added' : 'updated' };
          }
          // Offen ist eine Anmerkung, kein Fehler — dieselbe Einteilung wie
          // bei `warn` oben.
          return { success: false, isWarning: p.ausgang === 'offen',
                   set_number: p.blId, error: p.grund || '' };
        })).catch(logAndContinue('wanted-import:auftrag-ende'));
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
      await kette;
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
