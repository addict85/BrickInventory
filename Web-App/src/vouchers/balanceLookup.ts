// Balance of a LEGO gift card; if the bot protection kicks in, no further call follows.
import { reportAndDeliver } from '../infra/fehler';
import { hostAllowed } from '../infra/fremdeAdressen';
import { ALLOWED_BALANCE_HOSTS, type LegoFetch } from '../externalSources';

/** Taken from the prototype, not guessed — the part nobody could derive. */
const ENDPOINT = 'https://www.lego.com/api/graphql/giftCardBalanceQuery';
const LOGIN = 'https://www.lego.com/api/graphql/Login';

/** Here instead of in the frontend, because the route also checks the stored value. */
export const COUNTRIES = ['de-CH', 'de-DE', 'de-AT', 'fr-FR', 'it-IT', 'nl-NL', 'en-GB', 'en-US'] as const;

export const DEFAULT_COUNTRY = 'de-CH';

/** Without a stored issuing country, the country follows the account currency —
 * the same rule as in settings.js. */
export function countryForCurrency(currency: string | null | undefined): string {
  return (
    ({ CHF: 'de-CH', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' } as Record<string, string>)[String(currency)] ??
    DEFAULT_COUNTRY
  );
}

export function countryAllowed(country: string | null | undefined): boolean {
  return typeof country === 'string' && (COUNTRIES as readonly string[]).includes(country);
}

/** Not disguise, but necessary: without a browser identity the bot protection
 * does not answer at all. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const QUERY = `query giftCardBalanceQuery($cardNumber: String!, $pin: String!) {
  giftCard(cardNumber: $cardNumber, pin: $pin) {
    balance {
      formattedAmount
      formattedValue
      centAmount
      currencyCode
      __typename
    }
    __typename
  }
}`;

export type Abruf = LegoFetch;

/** The token has expired, or the card/PIN is wrong. */
export class NotLoggedIn extends Error {}

/** Its own type because an ACTION hangs off it: the caller stops and
 * does not ask again for a while. */
export class BotProtection extends Error {}

/** The login named its error in the body; unlike an unreadable body, this is not fatal. */
export class LoginRejected extends Error {}

export interface Balance {
  amount: number;
  currency: string;
  /** For display only. */
  formatted: string | null;
}

/** REPLACE, don't mask: of the number, the last four digits remain; of the PIN,
 * nothing. Runs over every text leaving this file. */
export function redact(text: string, number: string, pin: string | null): string {
  let out = String(text ?? '');
  if (number && number.length >= 4) {
    out = out.split(number).join(`…${number.slice(-4)}`);
  }
  // The PIN without a trace: four digits are too short to leave anything standing.
  if (pin) out = out.split(pin).join('…');
  return out;
}

function short(number: string): string {
  return number.length > 4 ? `…${number.slice(-4)}` : '…';
}

interface Session {
  token: string;
  cookies: Map<string, string>;
  expiry: number;
}

/** In memory, not in the database: the guest token belongs to no account. One session
 * per country; the store lives in the voucher services' slot (balanceThrottle.ts). */
export type SessionStore = Map<string, Session>;

/** 0 if it cannot be read. */
function jwtExpiry(token: string): number {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString()) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

function countryFrom(locale: string): string {
  return (locale.split('-')[1] ?? '').toUpperCase();
}

function captureCookies(res: { headers: { getSetCookie?: () => string[] } }, jar: Map<string, string>): void {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const pair = String(sc).split(';')[0] ?? '';
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

/** Every call in this file goes through the host check. */
async function fetchChecked(abruf: Abruf, url: string, init?: Record<string, unknown>) {
  if (!hostAllowed(url, ALLOWED_BALANCE_HOSTS)) {
    throw new Error(`Address not allowed: ${url}`);
  }
  return abruf(url, init);
}

/** 429 like 403: both mean "not now" and call for the same action —
 * stop, instead of asking again. */
function isBotProtection(status: number): boolean {
  return status === 403 || status === 429;
}

async function buildSession(abruf: Abruf, locale: string): Promise<Session> {
  const page = `https://www.lego.com/${locale.toLowerCase()}/gift-cards/balance`;
  const jar = new Map<string, string>();
  jar.set('locale', locale);
  jar.set('country', countryFrom(locale));

  const s = await fetchChecked(abruf, page, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
    },
  });
  if (!s.ok) {
    if (isBotProtection(s.status)) {
      throw new BotProtection(`The balance page answered with HTTP ${s.status} — bot protection.`);
    }
    throw new Error(`The balance page could not be loaded (HTTP ${s.status}).`);
  }
  captureCookies(s, jar);

  const login = await fetchChecked(abruf, LOGIN, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
      'content-type': 'application/json',
      authorization: '',
      'x-locale': locale,
      cookie: cookieHeader(jar),
      origin: 'https://www.lego.com',
      referer: page,
      'user-agent': UA,
    },
    body: JSON.stringify({ operationName: 'Login', query: 'mutation Login {\n  login\n}', variables: {} }),
  });
  if (!login.ok && isBotProtection(login.status)) {
    throw new BotProtection(`The login answered with HTTP ${login.status} — bot protection.`);
  }
  captureCookies(login, jar);

  let token = jar.get('gqauth') ?? null;
  if (!token) {
    // Fallback: the token is sometimes in the body instead of the cookie.
    try {
      const body = (await login.json()) as { data?: { login?: unknown }; errors?: { message?: string }[] };
      const value = body?.data?.login;
      if (typeof value === 'string' && value.split('.').length === 3) {
        token = value;
        jar.set('gqauth', value);
      } else if (body?.errors?.length) {
        throw new LoginRejected('Login: ' + body.errors.map(e => e.message ?? '?').join('; '));
      }
    } catch (e) {
      if (e instanceof LoginRejected) throw e;
    }
  }
  if (!token) {
    throw new Error(`No guest token received (login HTTP ${login.status}).`);
  }
  return { token, cookies: jar, expiry: jwtExpiry(token) };
}

async function getSession(store: SessionStore, abruf: Abruf, locale: string, fresh = false): Promise<Session> {
  const have = store.get(locale);
  // Five minutes of buffer before expiry.
  if (!fresh && have && have.expiry - Date.now() > 5 * 60_000) return have;
  const neu = await buildSession(abruf, locale);
  store.set(locale, neu);
  return neu;
}

async function queryBalance(abruf: Abruf, number: string, pin: string, locale: string, s: Session): Promise<Balance> {
  const jar = new Map(s.cookies);
  // A card is only valid in the shop of its issuing country.
  jar.set('locale', locale);
  jar.set('country', countryFrom(locale));

  const res = await fetchChecked(abruf, ENDPOINT, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
      'content-type': 'application/json',
      authorization: s.token,
      'x-locale': locale,
      cookie: cookieHeader(jar),
      origin: 'https://www.lego.com',
      referer: `https://www.lego.com/${locale.toLowerCase()}/gift-cards/balance`,
      'user-agent': UA,
    },
    body: JSON.stringify({
      operationName: 'giftCardBalanceQuery',
      variables: { cardNumber: number, pin },
      query: QUERY,
    }),
  });

  if (res.status === 401) throw new NotLoggedIn('Not logged in');
  if (!res.ok) {
    // Exception: the text only serves the message; it throws below regardless.
    const text = await res.text().catch(reportAndDeliver('guthaben:antworttext', ''));
    // redact() on the FOREIGN text too: an error message that echoes the input
    // would otherwise bring the PIN into the log.
    const safe = redact(text.slice(0, 300), number, pin);
    if (isBotProtection(res.status)) {
      throw new BotProtection(`HTTP ${res.status} — bot protection: ${safe}`);
    }
    throw new Error(`HTTP ${res.status}: ${safe}`);
  }

  const json = (await res.json()) as {
    errors?: { message?: string }[];
    data?: { giftCard?: { balance?: { centAmount?: unknown; currencyCode?: unknown; formattedAmount?: unknown } } };
  };
  if (json.errors?.length) {
    const text = json.errors.map(e => e.message ?? '?').join('; ');
    if (/unauthori[sz]ed/i.test(text)) throw new NotLoggedIn(redact(text, number, pin));
    throw new Error(redact(text, number, pin));
  }

  const b = json.data?.giftCard?.balance;
  const cent = Number(b?.centAmount);
  if (!b || !Number.isFinite(cent)) throw new Error('No balance given in the response');

  return {
    // Cents instead of parseFloat on the formatted text: how "1'250.00" is read
    // depends on the country.
    amount: cent / 100,
    currency: String(b.currencyCode ?? ''),
    formatted: typeof b.formattedAmount === 'string' ? b.formattedAmount : null,
  };
}

/** A retry only on 401 with a token from the store — it can have expired. */
export async function fetchBalance(
  store: SessionStore,
  number: string,
  pin: string,
  opt: { locale?: string; abruf: Abruf },
): Promise<Balance> {
  const locale = opt.locale || DEFAULT_COUNTRY;
  const abruf = opt.abruf;

  const wasInStore = store.has(locale);
  try {
    const s = await getSession(store, abruf, locale);
    try {
      return await queryBalance(abruf, number, pin, locale, s);
    } catch (e) {
      if (!(e instanceof NotLoggedIn) || !wasInStore) throw e;
      console.warn(`[guthaben] token expired, new session for ${short(number)}`);
      const fresh = await getSession(store, abruf, locale, true);
      return await queryBalance(abruf, number, pin, locale, fresh);
    }
  } catch (e) {
    // Two levels: building the session can also get a 403 from bot protection.
    if (e instanceof BotProtection) {
      store.delete(locale);
      console.warn(
        `[guthaben] bot protection — session for ${locale} discarded, ` +
          'the next attempt starts with a fresh page load',
      );
    }
    throw e;
  }
}
