/** requireApiAdmin bündelt Anmeldung und is_admin, damit kein Admin-Endpunkt
 * die Prüfung versehentlich weglässt. */
import { meldeFehler } from '../../src/infra/fehler';
import { imSystemkontext } from '../../src/infra/kontoKontext';
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { zuGrosseId } from '../../src/infra/validate';
import { kontoBereich, validateToken } from '../../src/konto';
import { resolveUserId, sendeTokenAbsage, nutzerId, zweiterFaktorPflicht } from '../../src/konto/http/anmeldung';
import { belegeKontoPlatz, type Schranke } from '../../src/http/kontoSchranke';
import { verlangeFreigabe } from '../../src/konto/http/schrittschutz';
import type { Sicht } from '../../src/haushalt';

/** Wer fragt und welche Konten er gewählt hat; den Bereich löst der Dienst auf. */
export const sichtVon = (req: AuthedRequest & { abfrage: { accounts?: string | undefined } }): Sicht => ({
  nutzer: req.apiUser.user_id,
  konten: req.abfrage.accounts,
});
import { sendeFehler } from '../../src/http/httpAntwort';
import { waechter } from '../../src/http/vertragsRouter';

export function bearerToken(req: { headers: { authorization?: string | undefined } }): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Alles andere verlangt die Anmeldung schon am Eingang: Eine neue Route, die
 * ihren eigenen Schutz vergisst, ist damit zu und nicht offen. */
const OEFFENTLICH: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/settings\/theme$/],
  // Die Anmeldeseite prüft damit, was vor dem ersten Konto noch fehlt.
  ['GET', /^\/einrichtung\/stand$/],
  ['GET', /^\/auth\/(me|registration-status)$/],
  // token-rotieren prüft selbst: Ein unbegrenzter Token nach der Pflichtfrist
  // gilt nur noch dort, und das kann der Eingang nicht wissen.
  [
    'POST',
    /^\/auth\/(login|logout|qr-login(?:\/abholen)?|register|forgot-password|reset-password|bestaetigung-erneut|email-bestaetigen(?:\/vorschau)?|token-rotieren)$/,
  ],
  ['POST', /^\/auth\/passkey\/anmelden(\/optionen)?$/],
];

/** Start- oder vom Verwalter vergebenes Passwort: Bis es ersetzt ist, geht nur der Wechsel.
 * Den Geräteschlüssel nimmt der Server nur gleich nach der Anmeldung an, also auch hier. */
const VOR_DEM_WECHSEL = /^\/(auth\/(change-password|logout)|geraet\/schluessel)$/;
/** Ein Verwalter ohne zweiten Faktor kommt nur bis zu dessen Einrichtung. */
const ZUR_EINRICHTUNG: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/auth\/(me|zweiter-faktor)$/],
  ['POST', /^\/auth\/(change-password|zweiter-faktor\/(einrichten|bestaetigen))$/],
  // Die Einrichtung in der App verlangt den Schrittschutz (src/konto/http/schrittschutz.ts).
  ['POST', /^\/geraet\/(schluessel|schritt\/(challenge|freigabe))$/],
];

/** Sitzungen von vor dem Feld fragen einmal die Datenbank und merken es sich. */
async function mussWechseln(req: Request): Promise<boolean> {
  if (!req.session?.userId) return req.apiUser?.muss_passwort_aendern === true;
  req.session.mussPasswortAendern ??= await kontoBereich().konten.mussPasswortAendern(req.session.userId);
  return req.session.mussPasswortAendern;
}

export async function anmeldungAmEingang(req: Request, res: Response, next: NextFunction) {
  const methode = req.method === 'HEAD' ? 'GET' : req.method;
  if (OEFFENTLICH.some(([m, re]) => m === methode && re.test(req.path))) return next();
  if (req.session?.userId) {
    req.apiUser = {
      user_id: req.session.userId,
      is_admin: !!req.session.isAdmin,
      ...(req.session.username ? { username: req.session.username } : {}),
    };
  } else {
    // Ein Lesefehler ist keine ungültige Anmeldung: Ein 401 meldete die App ab.
    const uid = await resolveUserId(req);
    if (!uid) return sendeTokenAbsage(req, res);
    req.tokenUserId = uid;
  }
  return eingangsSperre(req, res, next);
}

/** Die Sperren „Passwortwechsel nötig“ und „2. Faktor Pflicht“ für einen schon
 * erkannten Nutzer. Auch Dateien und Bild-Proxy hängen davor, weil sie vor dem
 * Eingang stehen und sonst an beiden Regeln vorbeiliefen. */
export async function eingangsSperre(req: Request, res: Response, next: NextFunction) {
  const methode = req.method === 'HEAD' ? 'GET' : req.method;
  if (!(methode === 'POST' && VOR_DEM_WECHSEL.test(req.path)) && (await mussWechseln(req)))
    return sendeFehler(req, res, 403, 'passwort_wechsel_noetig');
  if (!ZUR_EINRICHTUNG.some(([m, re]) => m === methode && re.test(req.path)) && (await zweiterFaktorPflicht(req)))
    return sendeFehler(req, res, 403, 'zweiter_faktor_pflicht');
  next();
}

export const requireToken = waechter<AuthedRequest>((req, res, next) => {
  // Schon am Eingang geprüft: kein zweiter Datenbankzugriff.
  if (req.apiUser) return next();
  if (req.session?.userId) {
    req.apiUser = {
      user_id: req.session.userId,
      is_admin: !!req.session.isAdmin,
      ...(req.session.username ? { username: req.session.username } : {}),
    };
    return next();
  }
  const token = bearerToken(req);
  validateToken(token, { ip: req.ip })
    .then(user => {
      if (!user) return sendeFehler(req, res, 401, 'token_ungueltig');
      req.apiUser = { ...user, is_admin: user.is_admin === true };
      next();
    })
    .catch((e: unknown) => {
      meldeFehler('eingang:token', e);
      sendeFehler(req, res, 401, 'auth_fehler');
    });
});

export const requireApiAdmin = waechter<AuthedRequest>((req, res, next) => {
  requireToken(req, res, () => {
    if (!req.apiUser?.is_admin) return sendeFehler(req, res, 403, 'nur_admins');
    // Hier statt in einer Pfadliste: So kommt keine Verwalter-Route an der Gerätesperre vorbei.
    // Die Verwaltung arbeitet über alle Konten (Diagnose, Kontenliste): Zeilenschutz aus.
    verlangeFreigabe(req, res, () => imSystemkontext('verwaltung', next), 'verwaltung');
  });
});

const nurWenn =
  (soll: (req: Request) => boolean, schritt: RequestHandler): RequestHandler =>
  (req, res, next) =>
    soll(req) ? schritt(req, res, next) : next();
const unangemeldet = (req: Request) => nutzerId(req) === null;

/** Ohne Konto sind es höchstens 16 KB: Wer dafür länger braucht, hält nur eine
 * Verbindung fest. Angemeldet gilt die Frist des Servers (Uploads). */
const RUMPF_FRIST_MS = 10_000;
function rumpfFrist(req: Request, res: Response, next: NextFunction) {
  if (req.complete) return next();
  const uhr = setTimeout(() => {
    if (req.complete || res.headersSent) return;
    res.setHeader('Connection', 'close');
    sendeFehler(req, res, 408, 'anfrage_zu_langsam');
  }, RUMPF_FRIST_MS);
  res.once('close', () => clearTimeout(uhr));
  req.once('end', () => clearTimeout(uhr));
  next();
}

/** Hinter anmeldungAmEingang: Ohne Konto (Anmelden, Registrieren, Zurücksetzen)
 * reichen 16 KB, sonst 256 KB, nur der PDF-Auftrag trägt die ganze Teileliste.
 * Pfad-IDs prüft vertragsRouter(), die in Rumpf und Abfrage der letzte Schritt. */
export const rumpfLesen: RequestHandler[] = [
  nurWenn(unangemeldet, rumpfFrist),
  nurWenn(unangemeldet, express.json({ limit: '16kb' })),
  nurWenn(unangemeldet, express.urlencoded({ extended: true, limit: '16kb' })),
  nurWenn(req => req.method === 'POST' && req.path === '/sets/partslist-pdf', express.json({ limit: '4mb' })),
  express.json({ limit: '256kb' }),
  express.urlencoded({ extended: true, limit: '256kb' }),
  (req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  }, // Express 5: sonst undefined
  (req, res, next) =>
    zuGrosseId(req.body) || zuGrosseId(req.query) ? sendeFehler(req, res, 400, 'id_ungueltig') : next(),
];

/** Vor dem Empfang des Rumpfs: Am Limit wird die Datei gar nicht erst gelesen. */
export function kontoSchranke(art: Schranke) {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = nutzerId(req);
    if (uid === null) return next();
    const frei = belegeKontoPlatz(art, uid);
    if (!frei) return sendeFehler(req, res, 429, art === 'strom' ? 'zu_viele_verbindungen' : 'upload_laeuft');
    res.once('finish', frei); // ein sofort folgender Upload käme sonst vor 'close' an
    res.once('close', frei);
    next();
  };
}
