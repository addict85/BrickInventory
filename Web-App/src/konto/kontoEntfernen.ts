/** Ein Konto endgültig entfernen — für den Verwalter und für das eigene Konto
 * derselbe Ablauf. Protokoll, Zeile und Sitzungen fallen in einer Transaktion:
 * Bliebe eine Sitzung übrig, wäre das gelöschte Konto noch angemeldet. */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import * as repo from './repository/konten';
import { increaseSessionVersion } from './sitzungsVersion';
import { emptyTokenCache } from './tokenCache';
import { reportError } from '../infra/fehler';
import { fachfehler, notFound } from '../infra/fehlerTexte';
import { inSystemContext } from '../infra/kontoKontext';
import type { AccountContext } from './kontext';

/** @param durch der Verwalter, der löscht; null, wenn das Konto sich selbst löscht */
export async function kontoEntfernen(k: AccountContext, ziel: number, durch: number | null): Promise<void> {
  // Immer im Systemrahmen: Sitzungen und die Kopien vor Migrationen sieht nur die Systemrolle.
  const fremd = durch !== null && durch !== ziel;
  const loeschen = () =>
    k.transaktion(async t => {
      // Vor dem Löschen: Danach ist der Name für das Protokoll nicht mehr zu ermitteln.
      if (durch !== null && fremd) await t.protokoll.protokolliere(durch, ziel, 'konto_geloescht');
      const weg = durch === null ? await t.konten.deleteOwnAccount(ziel) : await t.konten.deleteAccount(ziel, durch);
      if (weg === repo.LAST_ADMIN || (!weg && durch === null)) fachfehler('konflikt', 'letzter_verwalter');
      if (!weg) notFound('benutzer_nicht_gefunden_oder_eigenes');
      // user_sessions hat keinen Fremdschlüssel auf users.
      await increaseSessionVersion(t, ziel);
      await t.zugaenge.deleteSessionsOfAccount(ziel);
    });
  await inSystemContext('kontenverwaltung', loeschen);
  // Nach dem Festschreiben: Caches und Nachbarprozesse sollen das Konto erst vergessen, wenn es weg ist.
  emptyTokenCache(k);
  k.haushalt.reportHouseholdChange();
  await removeAccountFiles(k, ziel);
}

/** Ausgleich statt Fehlschlag: Das Konto ist gelöscht, nur seine Dateien liegen
 * noch da. Ein Auftrag versucht es wieder, bis Platte oder Rechte es zulassen. */
export async function removeAccountFiles(k: AccountContext, ziel: number): Promise<'entfernt' | 'eingereiht'> {
  try {
    await deleteAccountFiles(ziel);
    return 'entfernt';
  } catch (e) {
    reportError(`konto:dateien ${ziel}`, e);
    await k.auftraege.placeJobOne(
      'konto_dateien',
      { user_id: ziel },
      { schluessel: `konto_dateien:${ziel}`, maxAttempts: 10, afterSeconds: 60 },
    );
    return 'eingereiht';
  }
}

/** Eigene Anleitungen und Gutschein-PDFs gehören zum Konto; liegen blieben sie ohne Besitzer. */
export async function deleteAccountFiles(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  for (const art of ['uploads', 'vouchers'])
    await fs.promises.rm(path.join(DATA_DIR, art, String(userId)), { recursive: true, force: true });
}
