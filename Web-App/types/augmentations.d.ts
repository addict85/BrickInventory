/**
 * Typ-Augmentationen für express-session und Express.Request.
 * Ersetzt den gelöschten node-shim.d.ts — echte Typen kommen jetzt aus
 * @types/node, @types/express etc.; hier stehen nur die App-eigenen Felder.
 */
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Eingeloggter Benutzer (users.id) */
    userId?: number;
    username?: string;
    isAdmin?: boolean;
  }
}

declare global {
  /** Startup-Fortschritt, den /api/startup-status ausliefert (server.ts). */
  var startupStatus: { ready: boolean; step: string; progress: number; total: number };
  /** Aktiviert die Log-Persistenz in app_logs, sobald der DB-Pool bereit ist (server.ts). */
  var _enableLogPersistence: (pool: any) => void;

  namespace Express {
    interface Request {
      /**
       * Von der API-v1-Key-Middleware gesetzt: entweder der Session-Benutzer
       * oder der per X-Api-Key aufgelöste Benutzer (DB-Row: is_admin als 0/1).
       */
      apiUser?: { user_id: number; is_admin: number; username?: string; [k: string]: any };
      /** Von requireLoginOrToken gesetzt, wenn per Bearer-/Query-Token authentifiziert. */
      tokenUserId?: number;
    }
  }
}

export {};

/**
 * Request NACH requireToken/requireApiAdmin.
 *
 * ── Warum es diesen Typ gibt ────────────────────────────────────────────────
 * `apiUser` ist auf Express.Request optional deklariert — korrekt, denn auf
 * einer beliebigen Anfrage ist es nicht gesetzt. Hinter requireToken IST es
 * aber garantiert gesetzt: Die Middleware setzt es oder antwortet mit 401,
 * der Handler läuft in beiden Fällen nie mit fehlendem apiUser.
 *
 * Unter strictNullChecks meldete TypeScript sonst an 41 Stellen
 * "'req.apiUser' is possibly 'undefined'". Die naheliegende Antwort wäre
 * gewesen, überall `req.apiUser!` zu schreiben — das hätte die Meldung
 * beseitigt und die Prüfung gleich mit. Stattdessen benennt dieser Typ, was
 * die Middleware zusichert: Handler hinter requireToken annotieren ihren
 * Parameter als AuthedRequest, und die Zusicherung steht einmal geschrieben
 * statt 41-mal weggedrückt.
 *
 * WICHTIG: Der Typ erbt vom ECHTEN Express-Request (import('express').Request),
 * nicht vom gleichnamigen Interface im Express-Namensraum — jenes ist nur das
 * Ziel der Augmentierung oben und kennt weder params noch query noch body.
 */
declare global {
  type AuthedRequest = import('express').Request & {
    apiUser: { user_id: number; is_admin: number; username?: string; [k: string]: any };
  };
}
