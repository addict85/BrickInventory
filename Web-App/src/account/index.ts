/** The public face of the area: others import only from here, the cut below stays free. */
export { SignedIn, TokenWish } from './loginFlow';
export type { Account as AccountRow } from './repository/accounts';
export { OVERLAP_MS, ownAccess, tokenDigest, rotationDue } from './deviceToken';
export { assertLoginAllowed } from './loginCheck';
export { USERNAME_RE, emailValid, devicesNameValid, devicesNameContentValid, nameValid } from './nameRules';
export { reportLogin } from './loginLimiter';
export { QR_TTL_MS } from './qrPairing';
export { touchMs, touchThrottle } from './sessionTouch';
export { hashSessionIds, sessionDigest } from './sessionStore';
export {
  sessionIdleMs,
  sessionIdleSec,
  sessionMaxMs,
  sessionDeadlines,
  sessionMaxDuration,
} from './sessionDeadline';
export type { AdminAction } from './adminLog';
export { emailWillChange as emailBecomesChanged } from './changeProfile';
export type { ProfileInput } from './changeProfile';
export { createAccount } from './area';
export type { AccountServices, AccountContext } from './area';
