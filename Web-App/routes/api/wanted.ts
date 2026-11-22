/** /api/v2/wanted — the wanted list. The rules sit in src/wanted/; here
 * only scope, write permission and error translation. */
import type express from 'express';
import { publicError } from '../../src/infra/error';
import { lineToV1 } from '../../src/http/apiV1Alias';
import { translate, v1Keys, v1Values } from '../../src/contract/v1';
import { accountGate, viewOf, guardFor } from './middleware';
import { watchViaAccess } from '../../src/account/http/accessWatch';
import { errorText, responseLanguage, failDomain } from '../../src/infra/errorTexts';
import type { Correction } from '../../src/wanted';
import { csvReceive, xmlReceive } from '../../src/http/fileUpload';
import { WantedCorrections, type ImportInput } from '../../src/collection';
import type { CsvImportReport } from '../../src/infra/csvExport';
import { z } from 'zod';
import type { WantedXmlResult } from '../../src/contract/wanted';

import { jsonOrNull } from '../../src/infra/validate';
import { pageFrom } from '../../src/infra/page';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
type WantedXmlReport = Pick<
  z.infer<typeof WantedXmlResult>,
  'preview' | 'parsed' | 'created' | 'topped_up' | 'failed' | 'items' | 'open'
>;

/** Corrections as a field of the multipart request: with 224 items the address would be
 * longer than any proxy lets through. @returns null if they are invalid */
function correctionsFrom(raw: string | undefined, v1: boolean): Correction[] | undefined | null {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = jsonOrNull(raw)?.wert;
  // The JSON inside the form field is not seen by the alias; v1 clients name its fields in German.
  const parsed = WantedCorrections.safeParse(v1 ? translate(WantedCorrections, value, 'v2') : value);
  return parsed.success ? parsed.data : null;
}

/** An intermediate state line; v1 names the field, the count and the writing phase in German. */
const PROGRESS = v1Keys(
  z.looseObject({ phase: v1Values(z.string(), { write: 'schreiben' }), done: z.number(), total: z.number() }),
  { done: 'fertig' },
);
const PROGRESS_LINE = v1Keys(z.looseObject({ progress: PROGRESS }), { progress: 'fortschritt' });

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
  const row = (o: unknown, schema?: z.ZodType) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(lineToV1(res, o as object, schema)) + '\n');
    (res as unknown as { flush?: () => void }).flush?.();
  };
  const watch = watchViaAccess(d.account, req, () => {
    row({ success: false, error: errorText('access_ended', responseLanguage(req)), code: 'access_ended' });
    res.end();
  });
  await d.collection.runImport(uid, 'wanted_xml', eingabe, { progress: f => row({ progress: f }, PROGRESS_LINE) }).then(
    r => row({ success: true, ...r }),
    (e: unknown) => row({ success: false, ...publicError(e, 'wanted-import:strom', req) }),
  );
  watch();
  if (!res.writableEnded) res.end();
}

export function buildWantedRouter(d: Pick<Services, 'settings' | 'household' | 'account' | 'wanted' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  // Scope as everywhere: whoever looks for a gift sees the grandchildren's wanted items.
  router.endpoint('GET /api/v2/wanted', requireToken, async req => {
    const ids = viewOf(req);
    // The READER's currency; price_cache is keyed per currency, so it
    // belongs in the query.
    const currency = await d.settings.userValue(req.apiUser.user_id, 'currency', 'EUR');
    const item = await d.wanted.wantedItemsOf(ids, undefined, currency, {
      search: req.queryArgs.search,
      condition: req.queryArgs.condition,
      sort: req.queryArgs.sort,
    });
    const { entries, ...page } = pageFrom(item, req.queryArgs);
    return { item: entries, ...page };
  });

  /** All three paths (catalog, set number, barcode) end up here, so the rules
   * do not depend on the path. */
  router.endpoint('POST /api/v2/wanted', requireToken, async req => {
    const { set_number, condition, owner_user_id } = req.input;
    if (!set_number) failDomain('ungueltig', 'set_number_required');
    const owner = await d.household.writeTarget(req.apiUser.user_id, owner_user_id);
    const { item, was_new } = await d.wanted.addWantedItem(owner, set_number, condition);
    return { was_new, item };
  });

  // Two account checks: out of the one AND into the other account.
  router.endpoint('PUT /api/v2/wanted/:setNumber/:condition/owner', requireToken, async req => {
    const from = await d.household.writeTarget(req.apiUser.user_id, req.input.owner_user_id);
    const zu = await d.household.writeTarget(req.apiUser.user_id, req.input.new_owner);
    const r = await d.wanted.moveWantedItem(from, req.pathArgs.setNumber, req.pathArgs.condition, zu);
    return { ...r, owner_user_id: zu };
  });

  /** The condition is in the path because it belongs to the key: the same set can be
   * wanted new AND used. */
  router.endpoint('DELETE /api/v2/wanted/:setNumber/:condition', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner_user_id);
    const route = await d.wanted.removeWantedItem(owner, req.pathArgs.setNumber, req.pathArgs.condition);
    return { deleted: route };
  });

  /** BOTH conditions, freshly fetched. */
  router.endpoint('GET /api/v2/wanted/:setNumber/prices', requireToken, async req => {
    const sn = req.pathArgs.setNumber;
    const prices = await d.wanted.pricesForBothConditions(req.apiUser.user_id, sn);
    return { set_number: sn, ...prices };
  });

  /** The rule lives in wanted.ts:fulfillWantedItem(); here only who may write remains. */
  router.endpoint('POST /api/v2/wanted/:setNumber/:condition/take-over', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.input.owner_user_id);
    const r = await d.wanted.fulfillWantedItem(
      req.apiUser.user_id,
      owner,
      req.pathArgs.setNumber,
      req.pathArgs.condition,
      req.input ?? {},
    );
    return { ...r };
  });

  /** The counterpart of wantedListCsv(). */
  router.endpoint(
    'POST /api/v2/wanted/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      const owner = await d.household.writeTarget(req.apiUser.user_id, req.input.owner_user_id);

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
    'POST /api/v2/wanted-list/import/xml',
    requireToken,
    accountGate('upload'),
    xmlReceive.single('file'),
    async (req, res) => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      const xml = req.file.buffer.toString('utf-8');
      // Without <INVENTORY> there is no wanted list — a better answer than "0 items".
      if (!/<INVENTORY[\s>]/i.test(xml)) failDomain('nicht_verarbeitbar', 'no_wanted_list');
      const corrections = correctionsFrom(req.input.corrections, !!res.locals.apiV1);
      if (corrections === null) failDomain('ungueltig', 'corrections_invalid');
      const eingabe = {
        xml,
        fileName: String(req.file.originalname || 'wanted.xml').slice(0, 120),
        write: req.queryArgs.write ?? false,
        viaRebrickable: req.queryArgs.rebrickable ?? false,
        ...(corrections ? { corrections } : {}),
      };
      const uid = req.apiUser.user_id;
      if (!req.queryArgs.stream)
        return { ...(await d.collection.runImport<WantedXmlReport>(uid, 'wanted_xml', eingabe)) };

      await importInStream(d, req, res, uid, eingabe);
    },
  );
  return router;
}
