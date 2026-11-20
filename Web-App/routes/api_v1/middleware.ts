/** requireApiAdmin bündelt Anmeldung und is_admin, damit kein Admin-Endpunkt
 * die Prüfung versehentlich weglässt. */
import { reportError } from '../../src/infra/fehler';
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { toLargeId } from '../../src/infra/validate';
import type { AccountServices } from '../../src/konto';
import {
  loginOrTokenGuard,
  userIdTheRequest,
  sendTokenRejection,
  nutzerId,
  zweiterFaktorPflicht,
} from '../../src/konto/http/anmeldung';
import { receiptsAccountSpace, type Schranke } from '../../src/http/kontoSchranke';
import { requireRelease } from '../../src/konto/http/schrittschutz';
import type { Sicht } from '../../src/haushalt';

/** Wer fragt und welche Konten er gewählt hat; den Bereich löst der Dienst auf. */
export const viewOf = (req: AuthedRequest & { abfrage: { accounts?: string | undefined } }): Sicht => ({
  nutzer: req.apiUser.user_id,
  konten: req.abfrage.accounts,
});
import { sendError } from '../../src/http/httpAntwort';
import { Fachfehler, fachfehler } from '../../src/infra/fehlerTexte';
import { guard } from '../../src/http/vertragsRouter';

export function bearerToken(req: { headers: { authorization?: string | undefined } }): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Alles andere verlangt die Anmeldung schon am Eingang: Eine neue Route, die
 * ihren eigenen Schutz vergisst, ist damit zu und nicht offen. */
const PUBLIC: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/settings\/theme$/],
  // Die Anmeldeseite prüft damit, was vor dem ersten Konto noch fehlt.
  ['GET', /^\/einrichtung\/stand$/],
  ['GET', /^\/auth\/(me|registration-status)$/],
  // token-rotieren prüft selbst: Ein unbegrenzter Token nach der Pflichtfrist
  // gilt nur noch dort, und das kann der Eingang nicht wissen.
  [
    'POST',
    /^\/auth\/(login|logout|qr-login(?:\/abholen)?|register|forgot-password|reset-password|bestaetigung-erneut|email-bestaetigen(?:\/vorschau)?|token-rotieren|uebernahme-abbrechen|anmeldung-freigeben)$/,
  ],
  ['POST', /^\/auth\/passkey\/anmelden(\/optionen)?$/],
];

/** Start- oder vom Verwalter vergebenes Passwort: Bis es ersetzt ist, geht nur der Wechsel.
 * Den Geräteschlüssel nimmt der Server nur gleich nach der Anmeldung an, also auch hier. */
const VOR_DEM_WECHSEL = /^\/(auth\/(change-password|logout)|geraet\/schluessel)$/;
/** Ein Verwalter ohne zweiten Faktor kommt nur bis zu dessen Einrichtung. */
const TO_SETUP: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/auth\/(me|zweiter-faktor)$/],
  ['POST', /^\/auth\/(change-password|zweiter-faktor\/(einrichten|bestaetigen))$/],
  // Die Einrichtung in der App verlangt den Schrittschutz (src/konto/http/schrittschutz.ts).
  ['POST', /^\/geraet\/(schluessel|schritt\/(challenge|freigabe))$/],
];

/** Die Wächter des Eingangs, gebaut aus den Diensten des Kontos: Der Eingang
 * (startup/app.ts) und jeder Router nehmen dieselben. */
export function guardFor(konto: AccountServices) {
  return { ...inboxFor(konto), ...tokenGuardFor(konto), requireLoginOrToken: loginOrTokenGuard(konto) };
}

function inboxFor(konto: AccountServices) {
  /** Sitzungen von vor dem Feld fragen einmal die Datenbank und merken es sich. */
  async function switchMust(req: Request): Promise<boolean> {
    if (!req.session?.userId) return req.apiUser?.muss_passwort_aendern === true;
    req.session.mussPasswortAendern ??= await konto.passwordSwitchDue(req.session.userId);
    return req.session.mussPasswortAendern;
  }

  async function loginAtInbox(req: Request, res: Response, next: NextFunction) {
    const methode = req.method === 'HEAD' ? 'GET' : req.method;
    if (PUBLIC.some(([m, re]) => m === methode && re.test(req.path))) return next();
    if (req.session?.userId) {
      req.apiUser = {
        user_id: req.session.userId,
        is_admin: !!req.session.isAdmin,
        ...(req.session.username ? { username: req.session.username } : {}),
      };
    } else {
      // Ein Lesefehler ist keine ungültige Anmeldung: Ein 401 meldete die App ab.
      const uid = await userIdTheRequest(konto, req);
      if (!uid) return sendTokenRejection(req, res);
      req.tokenUserId = uid;
    }
    return inboundLock(req, res, next);
  }

  /** Die Sperren „Passwortwechsel nötig“ und „2. Faktor Pflicht“ für einen schon
   * erkannten Nutzer. Auch Dateien und Bild-Proxy hängen davor, weil sie vor dem
   * Eingang stehen und sonst an beiden Regeln vorbeiliefen. */
  async function inboundLock(req: Request, _res: Response, next: NextFunction) {
    const methode = req.method === 'HEAD' ? 'GET' : req.method;
    if (!(methode === 'POST' && VOR_DEM_WECHSEL.test(req.path)) && (await switchMust(req)))
      fachfehler('verboten', 'passwort_wechsel_noetig');
    if (!TO_SETUP.some(([m, re]) => m === methode && re.test(req.path)) && (await zweiterFaktorPflicht(konto, req)))
      fachfehler('verboten', 'zweiter_faktor_pflicht');
    next();
  }

  return { loginAtInbox, inboundLock };
}

function tokenGuardFor(konto: AccountServices) {
  const requireToken = guard<AuthedRequest>((req, _res, next) => {
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
    konto
      .nutzerZumToken(token, { ip: req.ip })
      .then(user => {
        if (!user) return next(new Fachfehler('nicht_angemeldet', 'token_ungueltig'));
        req.apiUser = { ...user, is_admin: user.is_admin === true };
        next();
      })
      .catch((e: unknown) => {
        reportError('eingang:token', e);
        next(new Fachfehler('nicht_angemeldet', 'auth_fehler'));
      });
  });

  return {
    requireToken,
    /** Ohne Systemrahmen: Wer über Konten geht, betritt ihn im Dienst (src/konto/kontext.ts). */
    requireApiAdmin: guard<AuthedRequest>((req, res, next) => {
      requireToken(req, res, (e?: unknown) => {
        if (e) return next(e);
        if (!req.apiUser?.is_admin) return next(new Fachfehler('verboten', 'nur_admins'));
        // Hier statt in einer Pfadliste: So kommt keine Verwalter-Route an der Gerätesperre vorbei.
        requireRelease(konto, req, res, next, 'verwaltung');
      });
    }),
  };
}

const onlyIf =
  (soll: (req: Request) => boolean, schritt: RequestHandler): RequestHandler =>
  (req, res, next) =>
    soll(req) ? schritt(req, res, next) : next();
const anonymous = (req: Request) => nutzerId(req) === null;

/** Ohne Konto sind es höchstens 16 KB: Wer dafür länger braucht, hält nur eine
 * Verbindung fest. Angemeldet gilt die Frist des Servers (Uploads). */
const BODY_DEADLINE_MS = 10_000;
function bodyDeadline(req: Request, res: Response, next: NextFunction) {
  if (req.complete) return next();
  // Ausnahme vom Fehlerweg: Die Uhr läuft nach next(), die Kette ist schon weiter.
  const uhr = setTimeout(() => {
    if (req.complete || res.headersSent) return;
    res.setHeader('Connection', 'close');
    sendError(req, res, 'zu_langsam', 'anfrage_zu_langsam');
  }, BODY_DEADLINE_MS);
  res.once('close', () => clearTimeout(uhr));
  req.once('end', () => clearTimeout(uhr));
  next();
}

/** Hinter loginAtInbox: Ohne Konto (Anmelden, Registrieren, Zurücksetzen)
 * reichen 16 KB, sonst 256 KB, nur der PDF-Auftrag trägt die ganze Teileliste.
 * Pfad-IDs prüft vertragsRouter('/api/v1'), die in Rumpf und Abfrage der letzte Schritt. */
export const readBody: RequestHandler[] = [
  onlyIf(anonymous, bodyDeadline),
  onlyIf(anonymous, express.json({ limit: '16kb' })),
  onlyIf(anonymous, express.urlencoded({ extended: true, limit: '16kb' })),
  onlyIf(req => req.method === 'POST' && req.path === '/sets/partslist-pdf', express.json({ limit: '4mb' })),
  express.json({ limit: '256kb' }),
  express.urlencoded({ extended: true, limit: '256kb' }),
  (req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  }, // Express 5: sonst undefined
  (req, _res, next) => {
    if (toLargeId(req.body) || toLargeId(req.query)) fachfehler('ungueltig', 'id_ungueltig');
    next();
  },
];

/** Vor dem Empfang des Rumpfs: Am Limit wird die Datei gar nicht erst gelesen. */
export function kontoSchranke(art: Schranke) {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = nutzerId(req);
    if (uid === null) return next();
    const frei = receiptsAccountSpace(art, uid);
    if (!frei) fachfehler('zu_viele', art === 'strom' ? 'zu_viele_verbindungen' : 'upload_laeuft');
    res.once('finish', frei); // ein sofort folgender Upload käme sonst vor 'close' an
    res.once('close', frei);
    next();
  };
}
