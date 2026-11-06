/** Die Guthabenabfrage bei LEGO: genau ein Host, auch nach einer Umleitung;
 * Zeit und Grösse begrenzt, weil der Abruf Kartennummer und PIN trägt. */
import { holeHttps } from '../src/infra/abruf';

export const ERLAUBTE_GUTHABEN_HOSTS = ['www.lego.com'] as const;

/** Die Form von fetch(), damit Tests ihn ersetzen können, ohne lego.com anzufassen. */
export type LegoAbruf = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean; status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  headers: { getSetCookie?: () => string[] };
}>;

export const legoAbruf: LegoAbruf = async (url, init = {}) => {
  const methode = init.method === 'POST' ? 'POST' : 'GET';
  const r = await holeHttps(url, { hosts: ERLAUBTE_GUTHABEN_HOSTS, methode, zeitlimitMs: 20_000,
    maxBytes: methode === 'POST' ? 512 * 1024 : 4 * 1024 * 1024,
    kopfzeilen: (init.headers ?? {}) as Record<string, string>,
    ...(typeof init.body === 'string' ? { rumpf: init.body } : {}) });
  const text = r.koerper.toString('utf8'), kekse = r.kopf['set-cookie'] ?? [];
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text,
           json: async () => JSON.parse(text) as unknown, headers: { getSetCookie: () => [...kekse] } };
};
