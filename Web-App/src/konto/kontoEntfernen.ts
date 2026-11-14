/** Ein Konto endgültig entfernen — für den Verwalter und für das eigene Konto
 * derselbe Ablauf. Protokoll, Zeile und Sitzungen fallen in einer Transaktion:
 * Bliebe eine Sitzung übrig, wäre das gelöschte Konto noch angemeldet. */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import * as repo from './repository/konten';
import { erhoeheSitzungsVersion } from './sitzungsVersion';
import { leereTokenCache } from './tokenCache';
import { meldeFehler } from '../infra/fehler';
import { imSystemkontext } from '../infra/kontoKontext';
import type { KontoKontext } from './kontext';

export type KontoEntfernt = 'entfernt' | 'nicht_gefunden' | typeof repo.LETZTER_VERWALTER;

/** @param durch der Verwalter, der löscht; null, wenn das Konto sich selbst löscht */
export async function kontoEntfernen(k: KontoKontext, ziel: number, durch: number | null): Promise<KontoEntfernt> {
  // Immer im Systemrahmen: Sitzungen und die Kopien vor Migrationen sieht nur die Systemrolle.
  const fremd = durch !== null && durch !== ziel;
  const loeschen = () =>
    k.transaktion(async t => {
      // Vor dem Löschen: Danach ist der Name für das Protokoll nicht mehr zu ermitteln.
      if (durch !== null && fremd) await t.protokoll.protokolliere(durch, ziel, 'konto_geloescht');
      const weg = durch === null ? await t.konten.loescheEigenesKonto(ziel) : await t.konten.loescheKonto(ziel, durch);
      if (weg === repo.LETZTER_VERWALTER) throw new Abbruch(weg);
      if (!weg) throw new Abbruch(durch === null ? repo.LETZTER_VERWALTER : 'nicht_gefunden');
      // user_sessions hat keinen Fremdschlüssel auf users.
      await erhoeheSitzungsVersion(t, ziel);
      await t.zugaenge.loescheSitzungenDesKontos(ziel);
      return 'entfernt' as const;
    });
  const r = await imSystemkontext('kontenverwaltung', loeschen).catch((e: unknown) => {
    if (e instanceof Abbruch) return e.ergebnis;
    throw e;
  });
  if (r !== 'entfernt') return r;
  // Nach dem Festschreiben: Caches und Nachbarprozesse sollen das Konto erst vergessen, wenn es weg ist.
  leereTokenCache(k);
  k.haushalt.meldeHaushaltsaenderung();
  await kontoDateienEntfernen(k, ziel);
  return r;
}

/** Ausgleich statt Fehlschlag: Das Konto ist gelöscht, nur seine Dateien liegen
 * noch da. Ein Auftrag versucht es wieder, bis Platte oder Rechte es zulassen. */
export async function kontoDateienEntfernen(k: KontoKontext, ziel: number): Promise<'entfernt' | 'eingereiht'> {
  try {
    await loescheKontoDateien(ziel);
    return 'entfernt';
  } catch (e) {
    meldeFehler(`konto:dateien ${ziel}`, e);
    await k.auftraege.stelleAuftragEin(
      'konto_dateien',
      { user_id: ziel },
      { schluessel: `konto_dateien:${ziel}`, maxVersuche: 10, nachSekunden: 60 },
    );
    return 'eingereiht';
  }
}

/** Eigene Anleitungen und Gutschein-PDFs gehören zum Konto; liegen blieben sie ohne Besitzer. */
export async function loescheKontoDateien(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  for (const art of ['uploads', 'vouchers'])
    await fs.promises.rm(path.join(DATA_DIR, art, String(userId)), { recursive: true, force: true });
}

class Abbruch extends Error {
  constructor(readonly ergebnis: Exclude<KontoEntfernt, 'entfernt'>) {
    super(ergebnis);
  }
}
