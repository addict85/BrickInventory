/** /api/v1/wanted — die Merkliste. Die Regeln stehen in src/merkliste/; hier
 * nur Blickfeld, Schreibrecht und Fehlerübersetzung. */
import { oeffentlicherFehler } from '../../src/infra/fehler';
import { fehlerAntwort, pfadParam } from '../../src/infra/httpAntwort';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { requireToken, kontoSchranke } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { legeMerkpostenAn, loescheMerkposten, verschiebeMerkposten, uebernimm, merkpostenVon, preiseBeiderZustaende } from '../../src/merkliste/merkliste';
import { getSetting } from '../../src/einstellungen/settings';
import { csvEmpfang, xmlEmpfang } from '../../src/infra/dateiEmpfang';
import type { Korrektur } from '../../src/merkliste/wantedListe';
import { importAlsAuftrag } from '../../src/auftraege/importAlsAuftrag';
import { WantedKorrekturen } from '../../src/auftraege/nutzlasten';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import type { z } from 'zod';
import type { WantedXmlErgebnis } from '../../src/infra/vertrag/merkliste';

import { jsonOderNull } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();
type WantedXmlBericht = z.infer<typeof WantedXmlErgebnis>;

// Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted
router.get('/wanted', requireToken, async (req: Anfrage<'GET /api/v1/wanted'>, res: Antwort<'GET /api/v1/wanted'>) => {
  const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.abfrage.accounts));
  // Die Währung des LESERS; price_cache ist je Währung verschlüsselt, deshalb
  // gehört sie in die Abfrage.
  const waehrung = await getSetting(req.apiUser.user_id, 'currency', 'EUR');
  const merkposten = await merkpostenVon(ids, undefined, waehrung, {
    suche:      req.abfrage.search,
    zustand:    req.abfrage.condition,
    sortierung: req.abfrage.sort,
  });
  res.json({ success: true, merkposten });
});

/** Alle drei Wege (Katalog, Setnummer, Barcode) landen hier, damit die Regeln
 * nicht vom Weg abhängen.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted */
router.post('/wanted', requireToken, async (req: Anfrage<'POST /api/v1/wanted'>, res: Antwort<'POST /api/v1/wanted'>) => {
  const { set_number, condition, owner_user_id } = req.eingabe;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const { merkposten, war_neu } = await legeMerkpostenAn(owner, set_number, condition);
  res.json({ success: true, war_neu, merkposten });
});

// Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#put-wanted-setnumber-condition-inhaber
router.put('/wanted/:setNumber/:condition/inhaber', requireToken, async (req: Anfrage<'PUT /api/v1/wanted/:setNumber/:condition/inhaber'>, res: Antwort<'PUT /api/v1/wanted/:setNumber/:condition/inhaber'>) => {
  const von = await resolveWriteTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
  const zu  = await resolveWriteTarget(req.apiUser.user_id, req.eingabe.neuer_inhaber);
  if (von === null || zu === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const r = await verschiebeMerkposten(von, pfadParam(req, 'setNumber'),
                                   pfadParam(req, 'condition'), zu);
  res.json({ success: true, ...r, owner_user_id: zu });
});

/** Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set kann
 * neu UND gebraucht gewünscht sein. */
router.delete('/wanted/:setNumber/:condition', requireToken, async (req: Anfrage<'DELETE /api/v1/wanted/:setNumber/:condition'>, res: Antwort<'DELETE /api/v1/wanted/:setNumber/:condition'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.abfrage.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const weg = await loescheMerkposten(owner, pfadParam(req, 'setNumber'), pfadParam(req, 'condition'));
  res.json({ success: true, geloescht: weg });
});

/** BEIDE Zustände, frisch geholt.
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#get-wanted-setnumber-preise */
router.get('/wanted/:setNumber/preise', requireToken, async (req: Anfrage<'GET /api/v1/wanted/:setNumber/preise'>, res: Antwort<'GET /api/v1/wanted/:setNumber/preise'>) => {
  const sn = pfadParam(req, 'setNumber');
  const { currency, current } = await preiseBeiderZustaende(req.apiUser.user_id, sn);
  res.json({ success: true, set_number: sn, currency, current });
});

/** Die Regel steht in merkliste.ts:uebernimm() — über addSet(), die eine
 * Wahrheit fürs Erfassen. Hier bleibt nur, wer schreiben darf. */
router.post('/wanted/:setNumber/:condition/uebernehmen', requireToken, async (req: Anfrage<'POST /api/v1/wanted/:setNumber/:condition/uebernehmen'>, res: Antwort<'POST /api/v1/wanted/:setNumber/:condition/uebernehmen'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const r = await uebernimm(req.apiUser.user_id, owner,
    pfadParam(req, 'setNumber'), pfadParam(req, 'condition'), req.eingabe ?? {});
  res.json({ success: true, ...r });
});

/** Das Gegenstück zu buildMerklisteCsv().
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-import-csv */
router.post('/wanted/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/wanted/import/csv'>, res: Antwort<'POST /api/v1/wanted/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');

    res.json(await importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'merkliste_csv',
      { owner, text: req.file.buffer.toString('utf-8') }));
  });

/** Die Vorschau ist die VORGABE: Ohne `schreiben=1` wird nichts angelegt, weil
 * die dritte Sicherheitsstufe der Abbildung nur eine Vermutung ist. Gerechnet
 * wird im Auftrag (jobs/wantedXmlImport.ts); mit `strom=1` gehen dessen
 * Zwischenstände als NDJSON-Zeilen hinaus, ohne als eine JSON-Antwort (App).
 * Ausführlich: docs/begruendungen/routes/api_v1/wanted.ts.md#post-wanted-list-import-xml */
router.post('/wanted-list/import/xml', requireToken, kontoSchranke('upload'), xmlEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/wanted-list/import/xml'>, res: Antwort<'POST /api/v1/wanted-list/import/xml'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const xml = req.file.buffer.toString('utf-8');
    // Ohne <INVENTORY> keine Wanted-Liste — eine bessere Auskunft als „0 Posten".
    if (!/<INVENTORY[\s>]/i.test(xml)) return sendeFehler(req, res, 422, 'keine_wanted_liste');
    // Korrekturen als Feld der Multipart-Anfrage: Bei 224 Posten wäre die Adresse
    // länger als jeder Proxy durchlässt.
    let korrekturen: Korrektur[] | undefined;
    const rohKorr = req.eingabe.korrekturen;
    if (rohKorr !== undefined && rohKorr.trim() !== '') {
      const geparst = WantedKorrekturen.safeParse(jsonOderNull(rohKorr)?.wert);
      if (!geparst.success) return sendeFehler(req, res, 400, 'korrekturen_ungueltig');
      korrekturen = geparst.data;
    }
    const eingabe = {
      xml, dateiName: String(req.file.originalname || 'wanted.xml').slice(0, 120),
      schreiben: req.abfrage.schreiben ?? false,
      ueberRebrickable: req.abfrage.rebrickable ?? false,
      ...(korrekturen ? { korrekturen } : {}),
    };
    const uid = req.apiUser.user_id;
    if (!req.abfrage.strom) return res.json(await importAlsAuftrag<WantedXmlBericht>(uid, 'wanted_xml', eingabe));

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Für Proxys, die ihrerseits puffern (nginx & Verwandte).
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const zeile = (o: unknown) => {
      if (res.writableEnded) return;
      res.write(JSON.stringify(o) + '\n');
      (res as unknown as { flush?: () => void }).flush?.();
    };
    try {
      zeile(await importAlsAuftrag(uid, 'wanted_xml', eingabe, { fortschritt: (f) => zeile({ fortschritt: f }) }));
    } catch (e) {
      // Die Kopfzeilen sind hinaus: Der Fehler kommt als letzte ZEILE, sonst
      // wartet der Client auf einen Bericht, der nie kommt.
      zeile({ success: false, ...oeffentlicherFehler(e, 'wanted-import:strom', req) });
    }
    res.end();
  });

router.use(fehlerAntwort);

export default router;
