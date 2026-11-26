/**
 * Type augmentations for express-session and Express.Request.
 * Replaces the deleted node-shim.d.ts — real types now come from
 * @types/node, @types/express etc.; only the app's own fields stand here.
 */
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Logged-in user (users.id) */
    userId?: number;
    username?: string;
    isAdmin?: boolean;
    /** Time of login (ms), basis of the maximum duration */
    angemeldetAm?: number;
    /** Last request of an admin session, to the minute (src/account/sessionDeadline.ts). */
    lastlyAt?: number;
    /** Start password not yet replaced; undefined for sessions from before the field. */
    mustChangePassword?: boolean;
    /** users.session_version at login; if it differs, the session has ended. */
    sitzungsVersion?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the API v1 key middleware: either the session user
       * or the user resolved via X-Api-Key (is_admin: admin right of this access).
       */
      apiUser?: {
        user_id: number;
        is_admin: boolean;
        username?: string;
        created_at?: string | Date;
        must_change_password?: boolean;
      };
      /** Set by requireLoginOrToken when authenticated via bearer/query token. */
      tokenUserId?: number;
      /** Why a presented token did not apply, if there is more to say than "invalid". */
      tokenRejection?: 'token_rotation_required' | 'too_many_requests';
      /** Body and query after the check against the contract (src/http/contractRouter.ts);
       * their type is set by Anfrage<K> from the contract. */
      eingabe: unknown;
      abfrage: unknown;
    }
  }
}

/**
 * Request AFTER requireToken/requireApiAdmin: `apiUser` is set there. The
 * VertragsRouter only passes this type on to steps behind a guard
 * that guarantees it (src/http/contractRouter.ts); without a guard a
 * handler with AuthedRequest is a compile error.
 */
declare global {
  type AuthedRequest = import('express').Request & {
    apiUser: {
      user_id: number;
      is_admin: boolean;
      username?: string;
      created_at?: string | Date;
      must_change_password?: boolean;
    };
  };
}
