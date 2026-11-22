/** Adding sets in bulk and as a stream: CSV import with progress, export, adding with supplement. */
import type express from 'express';
import { publicError } from '../../src/infra/error';
import { accountGate, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import { skippedHint } from '../../src/infra/csvExport';
import { sendCsv } from '../../src/http/csvResponse';
import { responseLanguage, failDomain } from '../../src/infra/errorTexts';
import { openStream, StreamClosed, type Stream } from '../../src/account/http/stream';
import { loginOrTokenGuard, signedInUserId } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

/** The set is created; if the access ends or the client disconnects, only the
 * supplement aborts. The stream is open: an error becomes the last event, no
 * status code anymore. `success` belongs to it: the clients read it like a response. */
async function supplementInStream(
  services: Pick<Services, 'account' | 'sets'>,
  stream: Stream,
  req: express.Request,
  r: { set_number: string; besitzer: number; name?: string | null },
) {
  const send = (d: object) => stream.sende(d);
  const result = { success: true, action: 'added', set_number: r.set_number };
  send({ step: 'meta', set: r.set_number });
  await services.sets
    .setSupplement(r.set_number, r.besitzer, d => stream.sendOrAbort(d))
    .then(
      k => {
        send({ step: 'done_meta', set: r.set_number });
        send({ step: 'done', ...result, name: k.name ?? r.name, catalog_pending: !k.name, supplement: 'done' });
      },
      (f: unknown) => {
        if (f instanceof StreamClosed) return;
        publicError(f, 'sets:add-stream', req);
        send({ step: 'done', ...result, name: r.name, catalog_pending: true, supplement: 'pending' });
      },
    );
  stream.ende();
}

export function buildSetsImportRouter(d: Pick<Services, 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  // ── CSV import: progress as a query and as a stream ──────────────────────────
  // 503 after 3 s instead of waiting: the status routes hang on every open
  // page and must not pile up when the database is full.
  const stateGuard = loginOrTokenGuard(d.account, { timeoutMs: 3000 });

  router.endpoint('GET /api/v2/sets/import/csv/status', stateGuard, async (req, res) => {
    res.json(await d.sets.csvImportStand(signedInUserId(req), req));
  });

  // Open streams per account are counted by kontoSchranke('stream') for all streams together.
  router.endpoint('GET /api/v2/sets/import/csv/stream', stateGuard, accountGate('stream'), async (req, res) => {
    const uid = signedInUserId(req);
    const stream = openStream(d.account, req, res, { onlyChanges: true, backpressure: `csv-import ${uid}` });
    // EventSource sets no headers, so the language comes as ?sprache=.
    const chosen = (req as express.Request & { queryArgs: { language?: string } }).queryArgs.language;
    const language = chosen === 'en' || chosen === 'de' ? chosen : responseLanguage(req);
    const sendStatus = async () => stream.sende(await d.sets.csvImportStatusForStream(uid, req, language));
    // Subscribe first, then send the first state: otherwise an event between
    // read and subscribe is lost. Other workers report via LISTEN/NOTIFY; the tick catches anything missed.
    stream.atEnd(d.sets.subscribeCsvImportStatus(uid, sendStatus));
    const tick = setInterval(sendStatus, 120000);
    stream.atEnd(() => clearInterval(tick));
    await sendStatus();
  });

  router.endpoint(
    'POST /api/v2/sets/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      const { total, uebersprungen, existing, started } = await d.sets.startSetCsvImport(
        signedInUserId(req),
        req.file.buffer.toString('utf-8'),
        req.queryArgs.check === true,
      );
      // Skipped rows belong in the immediate response; the import continues.
      return {
        total,
        started,
        existing: existing.length,
        existing_numbers: existing.slice(0, 20),
        skipped: uebersprungen.length || undefined,
        skipped_hint: skippedHint(uebersprungen, responseLanguage(req)) || undefined,
      };
    },
  );

  router.endpoint('POST /api/v2/sets/import/csv/cancel', requireToken, async req => {
    await d.sets.cancelSetCsvImport(signedInUserId(req));
    return {};
  });

  router.endpoint('GET /api/v2/sets/export/rebrickable', requireToken, async (req, res) => {
    sendCsv(
      res,
      `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
      ['Set Number', 'Quantity'],
      await d.sets.rebrickableList(signedInUserId(req)),
    );
  });

  router.endpoint('POST /api/v2/sets/add-stream', requireToken, accountGate('stream'), async (req, res) => {
    const e = req.input;
    const uid = signedInUserId(req);
    // Create first, then stream: an already existing set answers "exists", there is nothing to follow.
    // The job waits: the stream supplements itself and only needs it if it breaks off.
    const r = await d.sets.acquireSet({
      requester: uid,
      ownerWish: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      quantity: e.quantity ?? 1,
      kaufpreis: e.purchase_price ?? null,
      condition: e.condition?.toUpperCase() ?? null,
      lagerort: e.storage ?? null,
      recordedAt: e.date ?? null,
      currency: e.currency ?? null,
      supplementAfterSeconds: 60,
    });
    if (r.action === 'exists') {
      res.json({ success: true, ...r });
      return;
    }
    await supplementInStream(d, openStream(d.account, req, res, { heartbeat: false }), req, r);
  });

  router.endpoint('POST /api/v2/sets/:setNumber/parts', requireToken, async req => {
    return { count: await d.sets.importPartsOfSets(signedInUserId(req), req.pathArgs.setNumber) };
  });
  return router;
}
