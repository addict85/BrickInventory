/** /api/v1/wanted — die Merkliste. Die Regeln stehen in src/merkliste/; hier
 * nur Blickfeld, Schreibrecht und Fehlerübersetzung. */
import express from 'express';
import { fehlerAntwort, fehlertext, handleRouteError, logAndContinue, pfadParam } from '../../src/infra/httpError';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { legeMerkpostenAn, loescheMerkposten, verschiebeMerkposten, uebernimm, merkpostenVon, preiseBeiderZustaende } from '../../src/merkliste/merkliste';
import { getSetting } from '../../src/konto/settings';
import { csvEmpfang, xmlEmpfang } from '../../src/infra/dateiEmpfang';
import { csvZeilenAusAnfrage, csvImportAntwort, parseCsvDate } from '../../src/infra/csvExport';
import { importiereWantedListe } from '../../src/merkliste/wantedListe';
import type { Korrektur } from '../../src/merkliste/wantedListe';
import { merkeBlNummer } from '../../src/katalog/blZuordnung';
import { starteAuftrag, meldeAuftrag, beendeAuftrag, istAbgebrochen } from '../../src/auftraege/importAuftrag';
import { addManualPart } from '../../src/teile/manuelleTeile';
import { addManualFig } from '../../src/figuren/manuelleFiguren';
import { addSet } from '../../src/sets/setService';

import { jsonOderNull } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

// Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted
router.get('/wanted', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/wanted'>) => {
  const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  // Die Währung des LESERS; price_cache ist je Währung verschlüsselt, deshalb
  // gehört sie in die Abfrage.
  const waehrung = await getSetting(req.apiUser.user_id, 'currency', 'EUR');
  const merkposten = await merkpostenVon(ids, undefined, waehrung, {
    suche:      req.query.search,
    zustand:    req.query.condition,
    sortierung: req.query.sort,
  });
  res.json({ success: true, merkposten });
});

/** Alle drei Wege (Katalog, Setnummer, Barcode) landen hier, damit die Regeln
 * nicht vom Weg abhängen.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted */
router.post('/wanted', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/wanted'>) => {
  const { set_number, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const { merkposten, war_neu } = await legeMerkpostenAn(owner, set_number, condition);
  res.json({ success: true, war_neu, merkposten });
});

// Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#put-wanted-setnumber-condition-inhaber
router.put('/wanted/:setNumber/:condition/inhaber', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/wanted/:setNumber/:condition/inhaber'>) => {
  const von = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
  const zu  = await resolveWriteTarget(req.apiUser.user_id, req.body?.neuer_inhaber);
  if (von === null || zu === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const r = await verschiebeMerkposten(von, pfadParam(req, 'setNumber'),
                                   pfadParam(req, 'condition'), zu);
  res.json({ success: true, ...r, owner_user_id: zu });
});

/** Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set kann
 * neu UND gebraucht gewünscht sein. */
router.delete('/wanted/:setNumber/:condition', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/wanted/:setNumber/:condition'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.query.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const weg = await loescheMerkposten(owner, pfadParam(req, 'setNumber'), pfadParam(req, 'condition'));
  res.json({ success: true, geloescht: weg });
});

/** BEIDE Zustände, frisch geholt.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted-setnumber-preise */
router.get('/wanted/:setNumber/preise', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/wanted/:setNumber/preise'>) => {
  const sn = pfadParam(req, 'setNumber');
  const { currency, current } = await preiseBeiderZustaende(req.apiUser.user_id, sn);
  res.json({ success: true, set_number: sn, currency, current });
});

/** Die Regel steht in merkliste.ts:uebernimm() — über addSet(), die eine
 * Wahrheit fürs Erfassen. Hier bleibt nur, wer schreiben darf. */
router.post('/wanted/:setNumber/:condition/uebernehmen', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/wanted/:setNumber/:condition/uebernehmen'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const r = await uebernimm(req.apiUser.user_id, owner,
    pfadParam(req, 'setNumber'), pfadParam(req, 'condition'), req.body ?? {});
  res.json({ success: true, ...r });
});

/** Das Gegenstück zu buildMerklisteCsv().
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-import-csv */
router.post('/wanted/import/csv', requireToken, csvEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer } }, res: Antwort<'POST /api/v1/wanted/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');

    const { records, bereinigt, uebersprungen } =
      csvZeilenAusAnfrage(req.file.buffer.toString('utf-8'));

    let added = 0, updated = 0, errors = 0;
    const results: any[] = [];

    for (const row of bereinigt) {
      // Letzter Rückfall: eine Datei ohne Kopfzeile, erste Spalte = Setnummer —
      // dieselbe Nachsicht wie beim Minifiguren-Import.
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
  });

/** Die Vorschau ist die VORGABE: Ohne `schreiben=1` wird nichts angelegt, weil
 * die dritte Sicherheitsstufe der Abbildung nur eine Vermutung ist.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml */
router.post('/wanted-list/import/xml', requireToken, xmlEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer; originalname?: string } }, res: Antwort<'POST /api/v1/wanted-list/import/xml'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    // Vor dem try: Der catch-Zweig muss den Auftrag schliessen können.
    const uid = req.apiUser.user_id;
    // Zwei Merker: angefragt (für die Kette) und laufend (für den Abbruch).
    // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-auftragangefragt
    let auftragAngefragt = false;
    let auftragLaeuft = false;
    // Über eine Kette, weil der Rückruf synchron ist und das Schreiben nicht;
    // sonst stünde im Balken eine kleinere Zahl nach einer grösseren.
    let kette: Promise<unknown> = Promise.resolve();
    try {
      const xml = req.file.buffer.toString('utf-8');
      // Ohne <INVENTORY> keine Wanted-Liste — eine bessere Auskunft als „0 Posten",
      // was auch eine leere Liste sein kann.
      if (!/<INVENTORY[\s>]/i.test(xml))
        return sendeFehler(req, res, 422, 'keine_wanted_liste');

      // Korrekturen als Feld der Multipart-Anfrage: Bei 224 Posten wäre die Adresse
      // länger als jeder Proxy durchlässt.
      let korrekturen: Korrektur[] | undefined;
      const rohKorr = (req.body as { korrekturen?: unknown } | undefined)?.korrekturen;
      if (typeof rohKorr === 'string' && rohKorr.trim() !== '') {
        const geparst = jsonOderNull(rohKorr);
        if (!geparst || !Array.isArray(geparst.wert)) return sendeFehler(req, res, 400, 'korrekturen_ungueltig');
        korrekturen = geparst.wert as Korrektur[];
      }

      // Ohne `strom=1` eine JSON-Antwort wie bisher — der Weg der Android-App.
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
      const schreibeZeile = (o: unknown) => {
        if (!strom || res.writableEnded) return;
        res.write(JSON.stringify(o) + '\n');
        (res as unknown as { flush?: () => void }).flush?.();
      };

      // Der Auftragsdatensatz versorgt alle anderen Sitzungen und die App mit dem
      // Balken; der Strom nur diesen Tab.
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-schreiben
      const schreiben = String(req.query.schreiben ?? '') === '1';
      const anDenAuftrag = (stand: { fertig: number; gesamt: number }, unbedingt = false) => {
        if (!auftragLaeuft) return;
        kette = kette
          .then(() => meldeAuftrag(uid, { done: stand.fertig, total: stand.gesamt }, unbedingt))
          .catch(logAndContinue('wanted-import:auftrag'));
      };

      const bericht = await importiereWantedListe(uid, xml, {
        vorschau: !schreiben,
        ueberRebrickable: String(req.query.rebrickable ?? '') === '1',
        ...(korrekturen ? { korrekturen } : {}),
        merkeNummer: (art, rbId, blId) => merkeBlNummer(art, rbId, blId),
        // Ohne Strom ist der Rückruf nicht gesetzt, der Kern spart sich die Meldungen.
        fortschritt: (stand) => {
          schreibeZeile({ fortschritt: stand });
          // Beim ERSTEN Fortschritt angelegt: Vorher ist der Nenner nicht bekannt.
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
        ...(schreiben ? { abbruch: async () => auftragLaeuft && await istAbgebrochen(uid) } : {}),
        anleger: {
          teil:  (u, body) => addManualPart(u, body),
          figur: (u, body) => addManualFig(u, body),
          // Kaufpreis ist MAXPRICE aus der Datei.
          // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-3
          set:   (u, sn, menge, zustand, kaufpreis) =>
                   addSet(sn, menge, u, null, kaufpreis, zustand),
        },
      });
      // Erst die Kette abwarten, dann schliessen, dann antworten: Sonst stünde der
      // Balken anderswo noch auf „läuft".
      // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-4
      await kette;
      if (auftragLaeuft) {
        await beendeAuftrag(uid, {
          ok: bericht.angelegt + bericht.aufgestockt,
          // Offene Posten sind eine Anmerkung (⚠), weder angelegt noch gescheitert.
          warn: bericht.posten.filter(p => p.ausgang === 'offen').length,
          fehler: bericht.fehler,
          // Die BEARBEITETEN Posten, sonst bliebe der Balken vor dem Ende stehen.
          done: bericht.posten.length,
          abgebrochen: !!bericht.abgebrochen,
        },
        // Je Posten eine lesbare Zeile fürs Protokoll des Balkens.
        // Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml-5
        bericht.posten.map(p => {
          if (p.ausgang === 'angelegt' || p.ausgang === 'aufgestockt') {
            return { success: true, set_number: p.blId,
                     action: p.ausgang === 'angelegt' ? 'added' : 'updated' };
          }
          return { success: false, isWarning: p.ausgang === 'offen',
                   set_number: p.blId, error: p.grund || '' };
        })).catch(logAndContinue('wanted-import:auftrag-ende'));
      }
      if (strom) {
        // Die letzte Zeile ist der Bericht, dieselbe Nutzlast wie ohne Strom.
        schreibeZeile({ success: true, ...bericht });
        return res.end();
      }
      res.json({ success: true, ...bericht });
    } catch (e) {
      // Der Auftrag MUSS zu sein, auch nach einem Fehler, sonst zeigte der Balken
      // überall einen Import, den es nicht mehr gibt.
      await kette;
      if (auftragLaeuft) {
        await beendeAuftrag(uid, { ok: 0, fehler: 0, done: 0, abgebrochen: true })
          .catch(logAndContinue('wanted-import:auftrag-ende (Fehler)'));
      }
      // Die Kopfzeilen sind schon hinaus: Der Fehler muss als letzte ZEILE kommen,
      // sonst wartet der Client auf einen Bericht, der nie kommt.
      if (res.headersSent && !res.writableEnded) {
        res.write(JSON.stringify({ success: false, error: fehlertext(e) }) + '\n');
        return res.end();
      }
      handleRouteError(res, e, undefined, req);
    }
  });

router.use(fehlerAntwort);

export default router;
