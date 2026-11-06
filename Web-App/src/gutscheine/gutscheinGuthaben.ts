// Ausführlich: docs/begruendungen/src/gutscheine/gutscheinGuthaben.ts.md#abschnitt
import { meldeUndLiefere } from '../infra/fehler';
import { hostErlaubt } from '../infra/fremdeAdressen';
import { legoAbruf, ERLAUBTE_GUTHABEN_HOSTS, type LegoAbruf } from '../katalog/quellen';

/** Aus dem Prototyp übernommen, nicht geraten — der Teil, den niemand herleiten kann. */
const ENDPUNKT = 'https://www.lego.com/api/graphql/giftCardBalanceQuery';
const LOGIN    = 'https://www.lego.com/api/graphql/Login';


/** Hier statt in der Oberfläche, weil auch die Route den gespeicherten Wert prüft.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinGuthaben.ts.md#laender */
export const LAENDER = [
  'de-CH', 'de-DE', 'de-AT', 'fr-FR', 'it-IT', 'nl-NL', 'en-GB', 'en-US',
] as const;

export const LAND_STANDARD = 'de-CH';

/** Ohne gespeichertes Ausgabeland das Land zur Kontowährung — dieselbe Regel wie in 05-settings.js. */
export function landFuerWaehrung(waehrung: unknown): string {
  return ({ CHF: 'de-CH', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' } as Record<string, string>)[String(waehrung)] ?? LAND_STANDARD;
}

export function landErlaubt(land: unknown): boolean {
  return typeof land === 'string' && (LAENDER as readonly string[]).includes(land);
}

/** Keine Tarnung, sondern nötig: Ohne Browser-Kennung antwortet der Bot-Schutz
 * gar nicht erst. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const ABFRAGE = `query giftCardBalanceQuery($cardNumber: String!, $pin: String!) {
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

export type Abruf = LegoAbruf;

/** Der Token ist abgelaufen oder die Karte/PIN stimmt nicht. */
export class NichtAngemeldet extends Error {}

/** Eigener Typ, weil daran eine HANDLUNG hängt: Der Aufrufer hört auf und
 * fragt eine Weile gar nicht mehr. */
export class BotSchutz extends Error {}

export interface Guthaben {
  betrag: number;
  waehrung: string;
  /** Nur zur Anzeige. */
  angezeigt: string | null;
}

/** ERSETZEN, nicht maskieren: Von der Nummer bleiben die letzten vier Ziffern,
 * von der PIN nichts. Läuft über jeden Text, der diese Datei verlässt. */
export function verdecke(text: string, nummer: string, pin: string | null): string {
  let aus = String(text ?? '');
  if (nummer && nummer.length >= 4) {
    aus = aus.split(nummer).join(`…${nummer.slice(-4)}`);
  }
  // Die PIN ohne Rest: Vier Ziffern sind zu kurz, um etwas stehen zu lassen.
  if (pin) aus = aus.split(pin).join('…');
  return aus;
}

function kurz(nummer: string): string {
  return nummer.length > 4 ? `…${nummer.slice(-4)}` : '…';
}

interface Sitzung { token: string; kekse: Map<string, string>; ablauf: number }

/** Im Gedächtnis, nicht in der Datenbank: Der Gast-Token gehört keinem Konto.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinGuthaben.ts.md#sitzungen */
const sitzungen = new Map<string, Sitzung>();

/** 0, wenn er sich nicht lesen lässt. */
function jwtAblauf(token: string): number {
  try {
    const teil = token.split('.')[1];
    if (!teil) return 0;
    const nutz = JSON.parse(Buffer.from(teil, 'base64url').toString()) as { exp?: unknown };
    return typeof nutz.exp === 'number' ? nutz.exp * 1000 : 0;
  } catch { return 0; }
}

function keksKopf(topf: Map<string, string>): string {
  return [...topf].map(([k, v]) => `${k}=${v}`).join('; ');
}

function landVon(locale: string): string {
  return (locale.split('-')[1] ?? '').toUpperCase();
}

function kekseAufnehmen(res: { headers: { getSetCookie?: () => string[] } },
                        topf: Map<string, string>): void {
  const liste = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of liste) {
    const paar = String(sc).split(';')[0] ?? '';
    const i = paar.indexOf('=');
    if (i > 0) topf.set(paar.slice(0, i).trim(), paar.slice(i + 1).trim());
  }
}

/** Jeden Abruf dieser Datei durch die Hostprüfung. */
async function hole(abruf: Abruf, url: string, init?: Record<string, unknown>) {
  if (!hostErlaubt(url, ERLAUBTE_GUTHABEN_HOSTS)) {
    throw new Error(`Adresse nicht erlaubt: ${url}`);
  }
  return abruf(url, init);
}

/** 429 wie 403: Beides heisst „nicht jetzt" und verlangt dieselbe Handlung —
 * aufhören statt nachfragen. */
function istBotSchutz(status: number): boolean {
  return status === 403 || status === 429;
}

async function baueSitzung(abruf: Abruf, locale: string): Promise<Sitzung> {
  const seite = `https://www.lego.com/${locale.toLowerCase()}/gift-cards/balance`;
  const topf = new Map<string, string>();
  topf.set('locale', locale);
  topf.set('country', landVon(locale));

  const s = await hole(abruf, seite, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
    },
  });
  if (!s.ok) {
    if (istBotSchutz(s.status)) {
      throw new BotSchutz(`Die Guthabenseite antwortete mit HTTP ${s.status} — Bot-Schutz.`);
    }
    throw new Error(`Die Guthabenseite liess sich nicht laden (HTTP ${s.status}).`);
  }
  kekseAufnehmen(s, topf);

  const anmeldung = await hole(abruf, LOGIN, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
      'content-type': 'application/json',
      authorization: '',
      'x-locale': locale,
      cookie: keksKopf(topf),
      origin: 'https://www.lego.com',
      referer: seite,
      'user-agent': UA,
    },
    body: JSON.stringify({ operationName: 'Login', query: 'mutation Login {\n  login\n}',
                           variables: {} }),
  });
  if (!anmeldung.ok && istBotSchutz(anmeldung.status)) {
    throw new BotSchutz(`Die Anmeldung antwortete mit HTTP ${anmeldung.status} — Bot-Schutz.`);
  }
  kekseAufnehmen(anmeldung, topf);

  let token = topf.get('gqauth') ?? null;
  if (!token) {
    // Rückfall: Der Token steht manchmal im Rumpf statt im Keks.
    try {
      const rumpf = await anmeldung.json() as
        { data?: { login?: unknown }; errors?: { message?: string }[] };
      const aus = rumpf?.data?.login;
      if (typeof aus === 'string' && aus.split('.').length === 3) {
        token = aus;
        topf.set('gqauth', aus);
      } else if (rumpf?.errors?.length) {
        throw new Error('Login: ' + rumpf.errors.map(e => e.message ?? '?').join('; '));
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Login:')) throw e;
    }
  }
  if (!token) {
    throw new Error(`Kein Gast-Token erhalten (Login HTTP ${anmeldung.status}).`);
  }
  return { token, kekse: topf, ablauf: jwtAblauf(token) };
}

async function sitzung(abruf: Abruf, locale: string, frisch = false): Promise<Sitzung> {
  const da = sitzungen.get(locale);
  // Fünf Minuten Puffer vor dem Ablauf.
  if (!frisch && da && da.ablauf - Date.now() > 5 * 60_000) return da;
  const neu = await baueSitzung(abruf, locale);
  sitzungen.set(locale, neu);
  return neu;
}

export function vergesseSitzungen(): void { sitzungen.clear(); }

/** Für Tests der Route, die keinen Abruf durchreichen kann. */
let ersatz: Abruf | null = null;
export function _ersetzeAbruf(a: Abruf | null): void { ersatz = a; }

async function frageAb(
  abruf: Abruf, nummer: string, pin: string, locale: string, s: Sitzung,
): Promise<Guthaben> {
  const topf = new Map(s.kekse);
  // Eine Karte gilt nur im Shop ihres Ausgabelandes.
  topf.set('locale', locale);
  topf.set('country', landVon(locale));

  const res = await hole(abruf, ENDPUNKT, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': `${locale},de;q=0.9,en;q=0.8`,
      'content-type': 'application/json',
      authorization: s.token,
      'x-locale': locale,
      cookie: keksKopf(topf),
      origin: 'https://www.lego.com',
      referer: `https://www.lego.com/${locale.toLowerCase()}/gift-cards/balance`,
      'user-agent': UA,
    },
    body: JSON.stringify({ operationName: 'giftCardBalanceQuery',
                           variables: { cardNumber: nummer, pin }, query: ABFRAGE }),
  });

  if (res.status === 401) throw new NichtAngemeldet('Nicht angemeldet');
  if (!res.ok) {
    const text = await res.text().catch(meldeUndLiefere('guthaben:antworttext', ''));
    // verdecke() auch auf den FREMDEN Text: Eine Fehlermeldung, die die Eingabe
    // zurückwirft, brächte die PIN sonst ins Protokoll.
    const sicher = verdecke(text.slice(0, 300), nummer, pin);
    if (istBotSchutz(res.status)) {
      throw new BotSchutz(`HTTP ${res.status} — Bot-Schutz: ${sicher}`);
    }
    throw new Error(`HTTP ${res.status}: ${sicher}`);
  }

  const json = await res.json() as {
    errors?: { message?: string }[];
    data?: { giftCard?: { balance?: { centAmount?: unknown; currencyCode?: unknown;
                                      formattedAmount?: unknown } } };
  };
  if (json.errors?.length) {
    const text = json.errors.map(e => e.message ?? '?').join('; ');
    if (/unauthori[sz]ed/i.test(text)) throw new NichtAngemeldet(verdecke(text, nummer, pin));
    throw new Error(verdecke(text, nummer, pin));
  }

  const b = json.data?.giftCard?.balance;
  const cent = Number(b?.centAmount);
  if (!b || !Number.isFinite(cent)) throw new Error('Keine Guthabenangabe in der Antwort');

  return {
    // Rappen statt parseFloat auf den formatierten Text: Wie „1'250.00" zu lesen
    // ist, hängt am Land.
    betrag: cent / 100,
    waehrung: String(b.currencyCode ?? ''),
    angezeigt: typeof b.formattedAmount === 'string' ? b.formattedAmount : null,
  };
}

/** Ein Neuversuch nur bei 401 mit Token aus dem Vorrat — der kann abgelaufen sein.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinGuthaben.ts.md#holeguthaben */
export async function holeGuthaben(
  nummer: string, pin: string, opt: { locale?: string; abruf?: Abruf } = {},
): Promise<Guthaben> {
  const locale = opt.locale || LAND_STANDARD;
  const abruf = opt.abruf ?? ersatz ?? legoAbruf;

  const warImVorrat = sitzungen.has(locale);
  try {
    const s = await sitzung(abruf, locale);
    try {
      return await frageAb(abruf, nummer, pin, locale, s);
    } catch (e) {
      if (!(e instanceof NichtAngemeldet) || !warImVorrat) throw e;
      console.warn(`[guthaben] Token abgelaufen, neue Sitzung für ${kurz(nummer)}`);
      const frisch = await sitzung(abruf, locale, true);
      return await frageAb(abruf, nummer, pin, locale, frisch);
    }
  } catch (e) {
    // Zwei Ebenen: Auch der Aufbau der Sitzung kann 403 vom Bot-Schutz geben.
    if (e instanceof BotSchutz) {
      sitzungen.delete(locale);
      console.warn(`[guthaben] Bot-Schutz — Sitzung für ${locale} verworfen, `
                 + 'der nächste Versuch beginnt mit frischem Seitenaufruf');
    }
    throw e;
  }
}
