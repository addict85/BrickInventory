/** Behind login (the key is valid per account). Stored BEFORE the response
 * goes out: if the connection drops, the retry already finds it. */
import type { Request, Response, NextFunction } from 'express';
import { userId } from '../../account/http/login';
import { reportError } from '../../infra/error';
import * as service from '../service';
import { routeForRequest } from '../../contract';
import { notRetryable } from '../../contract/base';
import { sendError } from '../../http/httpResponse';
import type { IdempotencyServices } from '../area';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Responses of secret or confirmed routes (contract: `geheim`, `bestaetigung`)
 * never land in the table, not even encrypted. Their retry gets 409 instead of
 * a second run or the old response. */
export function responseIsSecret(method: string, path: string): boolean {
  return notRetryable(routeForRequest(method, path));
}

/** Only routes with a contract entry: without it, it's unknown whether the
 * response is secret, so nothing is stored and nothing is replayed. */
export function idempotency(d: IdempotencyServices) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.get('Idempotency-Key');
    if (key === undefined || !WRITE_METHODS.has(req.method)) return next();
    const route = routeForRequest(req.method, req.baseUrl + req.path);
    if (!route) return next();
    if (!service.KEY_PATTERN.test(key)) return sendError(req, res, 'ungueltig', 'idempotency_key_invalid');
    const uid = userId(req);
    if (uid === null) return next();

    const outcome = await d.begin(
      uid,
      key,
      service.fingerprint(req.method, req.originalUrl, req.body, req.apiUser?.is_admin === true),
    );
    if (outcome.kind === 'different') return sendError(req, res, 'nicht_verarbeitbar', 'idempotency_key_mismatch');
    if (outcome.kind === 'running') {
      res.set('Retry-After', '1');
      return sendError(req, res, 'konflikt', 'idempotency_running');
    }
    if (outcome.kind === 'not_replayable') return sendError(req, res, 'konflikt', 'idempotency_not_repeatable');
    if (outcome.kind === 'replay') {
      res.set('Idempotent-Replay', 'true');
      return res.status(outcome.status).type('application/json').send(outcome.response);
    }

    const secret = notRetryable(route);
    let recorded = false;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      recorded = true;
      void d
        .end(uid, key, res.statusCode, secret ? null : JSON.stringify(body))
        .catch((e: unknown) => reportError('idempotenz:merken', e))
        .finally(() => json(body));
      return res;
    };
    // No JSON response (file, stream): nothing to replay, the key is released.
    res.on('finish', () => {
      if (!recorded) d.release(uid, key, res.statusCode).catch((e: unknown) => reportError('idempotenz:freigeben', e));
    });
    // Every transaction of the route marks its effect on the key, in the same COMMIT.
    d.withEffectMark(uid, key, next);
  };
}
