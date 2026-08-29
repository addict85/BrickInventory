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

/**
 * Request NACH requireLogin.
 *
 * ── Dieselbe Begründung wie bei AuthedRequest ───────────────────────────────
 * `session.userId` ist oben mit gutem Grund optional deklariert: Auf einer
 * beliebigen Anfrage ist niemand angemeldet. Hinter requireLogin IST das Feld
 * gesetzt — die Middleware setzt es voraus oder antwortet mit 401, ein Handler
 * dahinter läuft nie ohne.
 *
 * Ohne diesen Typ landet man bei `req.session.userId!` an jeder Stelle, an der
 * eine Funktion eine echte Benutzer-ID verlangt. Das drückt die Meldung weg
 * und die Prüfung gleich mit: Käme derselbe Handler eines Tages VOR
 * requireLogin in die Kette, sagte niemand mehr etwas. Als Typ steht die
 * Zusicherung einmal geschrieben und ist an die Middleware gebunden, nicht an
 * die Erinnerung des Nächsten.
 */
/**
 * ── Warum auch username und isAdmin zugesichert sind (Nachtrag 155) ─────────
 *
 * Zuerst stand hier nur `{ userId: number }`. Das reichte nicht: In
 * POST /change-password werden alle drei Felder gelesen und an
 * establishSession() weitergegeben, die sie als Pflichtfelder verlangt.
 * TypeScript meldete zu Recht "string | undefined ist nicht string".
 *
 * Die Zusicherung ist nachgeprueft, nicht behauptet: `session.userId` wird im
 * ganzen Baum an KEINER Stelle direkt gesetzt — der einzige Weg hinein ist
 * establishSession(), und die schreibt userId, username und isAdmin immer
 * gemeinsam (drei Aufrufstellen, alle in routes/auth.ts). Wer eine davon
 * eines Tages aufteilt, muss diesen Typ mit anfassen; genau dafuer steht er
 * hier und nicht als `!` an der Aufrufstelle.
 */
declare global {
  type LoggedInRequest = import('express').Request & {
    session: import('express-session').Session &
             Partial<import('express-session').SessionData> &
             { userId: number; username: string; isAdmin: boolean };
  };
}
