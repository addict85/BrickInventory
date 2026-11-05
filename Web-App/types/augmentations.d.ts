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
    /** Zeitpunkt der Anmeldung (ms), Grundlage der Höchstdauer */
    angemeldetAm?: number;
    /** Startpasswort noch nicht ersetzt; undefined bei Sitzungen von vor dem Feld. */
    mussPasswortAendern?: boolean;
    /** Wann in dieser Sitzung zuletzt das Passwort eingegeben wurde (ms); Grundlage der Gnadenfrist. */
    passwortBestaetigtAm?: number;
    /** users.sitzungs_version bei der Anmeldung; weicht sie ab, ist die Sitzung beendet. */
    sitzungsVersion?: number;
  }
}

declare global {

  namespace Express {
    interface Request {
      /**
       * Von der API-v1-Key-Middleware gesetzt: entweder der Session-Benutzer
       * oder der per X-Api-Key aufgelöste Benutzer (DB-Row: is_admin als 0/1).
       */
      apiUser?: { user_id: number; is_admin: number; username?: string; created_at?: string | Date; muss_passwort_aendern?: boolean };
      /** Von requireLoginOrToken gesetzt, wenn per Bearer-/Query-Token authentifiziert. */
      tokenUserId?: number;
      /** Warum ein vorgelegter Token nicht galt, wenn es mehr zu sagen gibt als „ungültig“. */
      tokenAbsage?: 'token_rotation_noetig';
      /** Rumpf und Abfrage nach der Prüfung gegen den Vertrag (src/infra/vertrag/pruefen.ts);
       * ihren Typ setzt Anfrage<K> aus dem Vertrag. */
      eingabe: unknown;
      abfrage: unknown;
    }
  }
}

export {};

/**
 * Request NACH requireToken/requireApiAdmin: `apiUser` ist dort gesetzt. Der
 * VertragsRouter gibt diesen Typ nur an Schritte hinter einem Wächter weiter,
 * der ihn zusichert (src/infra/vertrag/pruefen.ts); ohne Wächter ist ein
 * Handler mit AuthedRequest ein Übersetzungsfehler.
 */
declare global {
  type AuthedRequest = import('express').Request & {
    apiUser: { user_id: number; is_admin: number; username?: string; created_at?: string | Date; muss_passwort_aendern?: boolean };
  };
}
