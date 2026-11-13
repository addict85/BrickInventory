/** Sitzungen und Zugänge eines Kontos beenden, wenn sich an seinem Schutz etwas ändert. */
import { erhoeheSitzungsVersion, vergissSitzungsVersion } from './sitzungsVersion';
import { kontoBereich } from './prozess';
import { hashToken, ZUGAENGE_HOECHSTENS } from './geraeteToken';
import { leereTokenCache } from './tokenCache';
import { imSystemkontext } from '../infra/kontoKontext';

export function begrenzeSitzungen(userId: number, eigene: string): Promise<number> {
  return kontoBereich().zugaenge.kappeSitzungen(userId, eigene, ZUGAENGE_HOECHSTENS - 1);
}

/** In user_sessions, wo der Session-Store wirklich liegt. */
export async function revokeAllSessions(userId: number): Promise<void> {
  await erhoeheSitzungsVersion(userId);
  await kontoBereich().zugaenge.loescheSitzungenDesKontos(userId);
}

/** Passwort, Zugänge und Passkeys zusammen, im Systemrahmen (auch ohne Anmeldung: Passwort
 * vergessen). Die Zwischenspeicher leeren sich nach dem COMMIT noch einmal, weil eine Anfrage
 * dazwischen den alten Stand wieder aufgenommen haben kann. */
export async function mitZugangsende<T>(konto: number | ((r: T) => number | null), fn: () => Promise<T>): Promise<T> {
  const r = await imSystemkontext('zugangsende', () =>
    kontoBereich().db.transaction(fn, { wiederholeBeiKonflikt: true }),
  );
  leereTokenCache();
  const uid = typeof konto === 'function' ? konto(r) : konto;
  if (uid) vergissSitzungsVersion(uid);
  return r;
}

/** Nach dem Einschalten des zweiten Faktors: Wer schon drin war, soll nicht
 * mit einem alten Token oder einer alten Sitzung drinbleiben. */
export async function beendeAndereZugaenge(
  userId: number,
  aktuellerToken: string | null,
  sitzungsId: string | null,
): Promise<number> {
  return mitZugangsende(userId, async () => {
    await kontoBereich().zugaenge.loescheTokensDesKontos(userId, aktuellerToken ? hashToken(aktuellerToken) : null);
    const v = await erhoeheSitzungsVersion(userId);
    await kontoBereich().zugaenge.loescheSitzungenDesKontos(userId, sitzungsId);
    return v;
  });
}
