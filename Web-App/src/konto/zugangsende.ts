/** Sitzungen und Zugänge eines Kontos beenden, wenn sich an seinem Schutz etwas ändert. */
import { erhoeheSitzungsVersion, vergissSitzungsVersion } from './sitzungsVersion';
import { hashToken, ZUGAENGE_HOECHSTENS } from './geraeteToken';
import { leereTokenCache } from './tokenCache';
import { imSystemkontext } from '../infra/kontoKontext';
import { imSystemrahmen } from '../infra/bereich';
import type { KontoKontext } from './kontext';

export function begrenzeSitzungen(k: KontoKontext, userId: number, eigene: string): Promise<number> {
  return k.zugaenge.kappeSitzungen(userId, eigene, ZUGAENGE_HOECHSTENS - 1);
}

/** In user_sessions, wo der Session-Store wirklich liegt. */
export async function revokeAllSessions(k: KontoKontext, userId: number): Promise<void> {
  await erhoeheSitzungsVersion(k, userId);
  await k.zugaenge.loescheSitzungenDesKontos(userId);
}

/** Eine Transaktion über Zugangsdaten im Systemrahmen (die Anmeldung sucht sie, bevor es
 * ein Konto gibt). In einer laufenden nur, wenn sie selbst im Systemrahmen läuft. */
export function zugangsTransaktion<T>(k: KontoKontext, fn: (t: KontoKontext) => Promise<T>): Promise<T> {
  return imSystemrahmen(k.db, 'zugangsdaten', () => k.transaktion(fn));
}

/** Passwort, Zugänge und Passkeys zusammen, im Systemrahmen (auch ohne Anmeldung: Passwort
 * vergessen). Die Zwischenspeicher leeren sich nach dem COMMIT noch einmal, weil eine Anfrage
 * dazwischen den alten Stand wieder aufgenommen haben kann. */
export async function mitZugangsende<T>(
  k: KontoKontext,
  konto: number | ((r: T) => number | null),
  fn: (t: KontoKontext) => Promise<T>,
): Promise<T> {
  const r = await imSystemkontext('zugangsende', () => k.transaktion(fn, { wiederholeBeiKonflikt: true }));
  leereTokenCache(k);
  const uid = typeof konto === 'function' ? konto(r) : konto;
  if (uid) vergissSitzungsVersion(k, uid);
  return r;
}

/** Nach dem Einschalten des zweiten Faktors: Wer schon drin war, soll nicht
 * mit einem alten Token oder einer alten Sitzung drinbleiben. */
export async function beendeAndereZugaenge(
  k: KontoKontext,
  userId: number,
  aktuellerToken: string | null,
  sitzungsId: string | null,
): Promise<number> {
  return mitZugangsende(k, userId, async t => {
    await t.zugaenge.loescheTokensDesKontos(userId, aktuellerToken ? hashToken(aktuellerToken) : null);
    const v = await erhoeheSitzungsVersion(t, userId);
    await t.zugaenge.loescheSitzungenDesKontos(userId, sitzungsId);
    return v;
  });
}
