/** Sitzungen und Zugänge eines Kontos beenden, wenn sich an seinem Schutz etwas ändert. */
import { erhoeheSitzungsVersion, horcheAufSitzungsVersion, vergissSitzungsVersion } from './sitzungsVersion';
import { tokenAbdruck, ZUGAENGE_HOECHSTENS } from './geraeteToken';
import { horcheAufTokenWiderruf, leereTokenCache } from './tokenCache';
import { imSystemkontext } from '../infra/kontoKontext';
import { imSystemrahmen } from '../infra/bereich';
import type { KontoKontext } from './kontext';

/** Token-Zwischenspeicher und Sitzungsversionen dieses Prozesses folgen den Widerrufen der anderen (NOTIFY). */
export function horcheAufWiderruf(k: KontoKontext): void {
  horcheAufTokenWiderruf(k);
  horcheAufSitzungsVersion(k);
}

export function begrenzeSitzungen(k: KontoKontext, userId: number, eigene: string): Promise<number> {
  return k.zugaenge.kappeSitzungen(userId, eigene, ZUGAENGE_HOECHSTENS - 1);
}

/** In user_sessions, wo der Session-Store wirklich liegt. */
export async function alleSitzungenBeenden(k: KontoKontext, userId: number): Promise<void> {
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

/** Alle Sitzungen ausser der eigenen, mit `zugaenge` auch die App-Zugänge ausser dem eigenen.
 * Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
export async function beendeAndere(
  k: KontoKontext,
  uid: number,
  o: { sitzung: string | null; token: string | null; zugaenge: boolean },
): Promise<{ sitzungen: number; zugaenge: number; version: number }> {
  return mitZugangsende(k, uid, async t => {
    const zugaenge = o.zugaenge
      ? await t.konten.andereZugaengeLoeschen(uid, o.token ? tokenAbdruck(o.token) : null)
      : 0;
    const version = await erhoeheSitzungsVersion(t, uid);
    const sitzungen = await t.konten.loescheAndereSitzungen(uid, o.sitzung ?? '');
    return { sitzungen, zugaenge, version };
  });
}
