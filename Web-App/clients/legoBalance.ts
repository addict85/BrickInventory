/** The balance query at LEGO: exactly one host, even after a redirect;
 * time and size limited, because the request carries card number and PIN. */
import { holeHttps } from '../src/infra/fetch';

export const ALLOWED_BALANCE_HOSTS = ['www.lego.com'] as const;

/** The shape of fetch(), so tests can replace it without touching lego.com. */
export type LegoFetch = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  headers: { getSetCookie?: () => string[] };
}>;

export const legoFetch: LegoFetch = async (url, init = {}) => {
  const methode = init.method === 'POST' ? 'POST' : 'GET';
  const r = await holeHttps(url, {
    hosts: ALLOWED_BALANCE_HOSTS,
    methode,
    zeitlimitMs: 20_000,
    maxBytes: methode === 'POST' ? 512 * 1024 : 4 * 1024 * 1024,
    kopfzeilen: (init.headers ?? {}) as Record<string, string>,
    ...(typeof init.body === 'string' ? { rumpf: init.body } : {}),
  });
  const text = r.koerper.toString('utf8'),
    cookies = r.kopf['set-cookie'] ?? [];
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
    headers: { getSetCookie: () => [...cookies] },
  };
};
