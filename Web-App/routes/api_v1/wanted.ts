/** /api/v1/wanted — the wanted list. The rules sit in src/wanted/; here
 * only scope, write permission and error translation. */
import type express from 'express';
import { publicError } from '../../src/infra/error';
import { accountGate, viewOf, guardFor } from './middleware';
import { watchViaAccess } from '../../src/account/http/accessWatch';
import { errorText, responseLanguage, failDomain } from '../../src/infra/errorTexts';
import type { Correction } from '../../src/wanted';
import { csvReceive, xmlReceive } from '../../src/http/fileUpload';
import { WantedCorrections, type ImportInput } from '../../src/collection';
import type { CsvImportReport } from '../../src/infra/csvExport';
import type { z } from 'zod';
import type { WantedXmlResult } from '../../src/contract/wanted';

import { jsonOrNull } from '../../src/infra/validate';
import { pageFrom } from '../../src/infra/page';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
type WantedXmlReport = Pick<
  z.infer<typeof WantedXmlResult>,
  'vorschau' | 'gelesen' | 'angelegt' | 'aufgestockt' | 'fehler' | 'posten' | 'offen'
>;

/** Corrections as a field of the multipart request: with 224 items the address would be
 * longer than any proxy lets through. @returns null if they are invalid */
function correctionsFrom(raw: string | undefined): Correction[] | undefined | null {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = WantedCorrections.safeParse(jsonOrNull(raw)?.wert);
  return parsed.success ? parsed.data : null;
}

/** The intermediate states as NDJSON lines. If the access ends, the stream ends; the
 * job keeps running on its own. The headers are out: an error comes
 * as the last LINE, otherwise the client waits for a report that never comes. */
async function importInStream(
  d: Pick<Services, 'settings' | 'household' | 'account' | 'wanted' | 'collection'>,
  req: express.Request,
  res: express.Response,
  uid: number,
  eingabe: ImportInput<'wanted_xml'>,
) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // For proxies that buffer themselves (nginx & relatives).
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const row = (o: unknown) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(o) + '\n');
    (res as unknown as { flush?: () => void }).flush?.();
  };
  const watch = watchViaAccess(d.account, req, () => {
    row({ success: false, error: errorText('zugang_beendet', responseLanguage(req)), code: 'zugang_beendet' });
    res.end();
  });
  await d.collection.runImport(uid, 'wanted_xml', eingabe, { progress: f => row({ fortschritt: f }) }).then(
    r => row({ success: true, ...r }),
    (e: unknown) => row({ success: false, ...publicError(e, 'wanted-import:strom', req) }),
  );
  watch();
  if (!res.writableEnded) res.end();
}

export function buildWantedRouter(d: Pick<Services, 'settings' | 'household' | 'account' | 'wanted' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v1');

  // Scope as everywhere: whoever looks for a gift sees the grandchildren's wanted items.
  router.endpoint('GET /api/v1/wanted', requireToken, async req => {
    const ids = viewOf(req);
    // The READER's currency; price_cache is keyed per currency, so it
    // belongs in the query.
    const currency = await d.settings.userValue(req.apiUser.user_id, 'currency', 'EUR');
    const merkposten = await d.wanted.wantedItemsOf(ids, undefined, currency, {
      search: req.abfrage.search,
      condition: req.abfrage.condition,
      sort: req.abfrage.sort,
    });
    const { eintraege, ...page } = pageFrom(merkposten, req.abfrage);
    return { merkposten: eintraege, ...page };
  });

  /** All three paths (catalog, set number, barcode) end up here, so the rules
   * do not depend on the path. */
  router.endpoint('POST /api/v1/wanted', requireToken, async req => {
    const { set_number, condition, owner_user_id } = req.eingabe;
    if (!set_number) failDomain('ungueltig', 'set_number_erforderlich');
    const owner = await d.household.writeTarget(req.apiUser.user_id, owner_user_id);
    const { merkposten, war_neu } = await d.wanted.addWantedItem(owner, set_number, condition);
    return { war_neu, merkposten };
  });

  // Two account checks: out of the one AND into the other account.
  router.endpoint('PUT /api/v1/wanted/:setNumber/:condition/inhaber', requireToken, async req => {
    const from = await d.household.writeTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
    const zu = await d.household.writeTarget(req.apiUser.user_id, req.eingabe.neuer_inhaber);
    const r = await d.wanted.moveWantedItem(from, req.pfad.setNumber, req.pfad.condition, zu);
    return { ...r, owner_user_id: zu };
  });

  /** The condition is in the path because it belongs to the key: the same set can be
   * wanted new AND used. */
  router.endpoint('DELETE /api/v1/wanted/:setNumber/:condition', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.abfrage.owner_user_id);
    const route = await d.wanted.removeWantedItem(owner, req.pfad.setNumber, req.pfad.condition);
    return { geloescht: route };
  });

  /** BOTH conditions, freshly fetched. */
  router.endpoint('GET /api/v1/wanted/:setNumber/preise', requireToken, async req => {
    const sn = req.pfad.setNumber;
    const prices = await d.wanted.pricesForBothConditions(req.apiUser.user_id, sn);
    return { set_number: sn, ...prices };
  });

  /** The rule lives in wanted.ts:fulfillWantedItem(); here only who may write remains. */
  router.endpoint('POST /api/v1/wanted/:setNumber/:condition/uebernehmen', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
    const r = await d.wanted.fulfillWantedItem(
      req.apiUser.user_id,
      owner,
      req.pfad.setNumber,
      req.pfad.condition,
      req.eingabe ?? {},
    );
    return { ...r };
  });

  /** The counterpart of wantedListCsv(). */
  router.endpoint(
    'POST /api/v1/wanted/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'keine_datei');
      const owner = await d.household.writeTarget(req.apiUser.user_id, req.eingabe.owner_user_id);

      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'merkliste_csv', {
          owner,
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  /** The preview is the DEFAULT: without `schreiben=1` nothing is created, because
   * the third confidence level of the mapping is only a guess. The computation happens
   * in the job (src/collection/wantedXmlImport.ts); with `strom=1` its intermediate
   * states go out as NDJSON lines instead of one JSON response (app). */
  router.endpoint(
    'POST /api/v1/wanted-list/import/xml',
    requireToken,
    accountGate('upload'),
    xmlReceive.single('file'),
    async (req, res) => {
      if (!req.file) failDomain('ungueltig', 'keine_datei');
      const xml = req.file.buffer.toString('utf-8');
      // Without <INVENTORY> there is no wanted list — a better answer than "0 items".
      if (!/<INVENTORY[\s>]/i.test(xml)) failDomain('nicht_verarbeitbar', 'keine_wanted_liste');
      const korrekturen = correctionsFrom(req.eingabe.korrekturen);
      if (korrekturen === null) failDomain('ungueltig', 'korrekturen_ungueltig');
      const eingabe = {
        xml,
        fileName: String(req.file.originalname || 'wanted.xml').slice(0, 120),
        schreiben: req.abfrage.schreiben ?? false,
        viaRebrickable: req.abfrage.rebrickable ?? false,
        ...(korrekturen ? { korrekturen } : {}),
      };
      const uid = req.apiUser.user_id;
      if (!req.abfrage.strom) return { ...(await d.collection.runImport<WantedXmlReport>(uid, 'wanted_xml', eingabe)) };

      await importInStream(d, req, res, uid, eingabe);
    },
  );
  return router;
}
