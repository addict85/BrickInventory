import * as db from '../../db/database';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { nacharbeit } from '../auftraege/nacharbeit';
import { schreibeNutzerEinstellung, nutzerWertGueltig, deleteUserSetting } from '../einstellungen/settings';
import { fehlerWerfen } from '../infra/fehlerTexte';
import { zaehleAnfrage } from './loginLimiter';
import * as repo from './repository/waehrung';

/** Die eine Schreibstelle: Ein Währungswechsel muss den Preis-Job anstossen,
 * weil der Preis-Cache je Währung verschlüsselt ist.
 * Ausführlich: docs/begruendungen/src/konto/nutzerEinstellung.ts.md#setusersetting */
export async function setUserSetting(userId: number, key: string, value: unknown) {
  if (key !== 'currency') return schreibeNutzerEinstellung(userId, key, value);
  const v = String(value).trim();
  if (!nutzerWertGueltig(key, v)) fehlerWerfen('wert_ungueltig', 400);
  return setzeHaushaltswaehrung(userId, v);
}

/** Für den ganzen Haushalt: Zwei Währungen ergäben eine Summe, der man den
 * Fehler nicht ansieht. redeemInvite() prüft unter derselben Sperre. */
async function setzeHaushaltswaehrung(userId: number, waehrung: string) {
  const vorher = await db.transaction(async (tx) => {
    await sperreHaushaltswaehrung(tx);
    const alt = await repo.waehrungIn(tx, userId);
    const unterkonto = await repo.hatHauptkonto(tx, userId);
    if (alt !== waehrung) {
      if (unterkonto) fehlerWerfen('waehrung_nur_hauptkonto', 403);
      // Jeder Wechsel stösst einen vollen Preislauf an.
      const takt = await zaehleAnfrage('waehrung', `konto:${userId}`, 60 * 60 * 1000);
      if (takt.count > 5) fehlerWerfen('zu_viele_anfragen', 429, { minuten: takt.waitMin });
    }
    if (unterkonto) return alt;
    const haushalt = await repo.eigenerHaushalt(tx, userId);
    if ((await repo.fremdGeteilt(tx, haushalt, waehrung)).length) {
      if (alt !== waehrung) fehlerWerfen('waehrung_geteiltes_unterkonto', 409);
      return alt;
    }
    await repo.setzeWaehrungFuer(tx, haushalt, waehrung);
    return alt;
  });
  if (vorher !== waehrung) {
    console.log(`[settings] Währung für Benutzer ${userId} und seinen Haushalt geändert (${vorher ?? '—'} → ${waehrung}) — Preis-Job wird angestossen`);
    setImmediate(() => nacharbeit().preisJobAnstossen());
  }
}

export async function setzeEigenesDesign(userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) { await deleteUserSetting(userId, 'app_theme'); return; }
  await setUserSetting(userId, 'app_theme', v);
}
