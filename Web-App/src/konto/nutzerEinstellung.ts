import * as db from '../../db/database';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { nacharbeit } from '../auftraege';
import { schreibeNutzerEinstellung, nutzerWertGueltig, deleteUserSetting } from '../einstellungen';
import { fachfehler } from '../infra/fehlerTexte';
import { zaehleAnfrage } from './loginLimiter';
import * as repo from './repository/waehrung';

/** Die eine Schreibstelle: Ein Währungswechsel muss den Preis-Job anstossen,
 * weil der Preis-Cache je Währung verschlüsselt ist. */
export async function setUserSetting(userId: number, key: string, value: unknown) {
  if (key !== 'currency') return schreibeNutzerEinstellung(userId, key, value);
  const v = String(value).trim();
  if (!nutzerWertGueltig(key, v)) fachfehler('ungueltig', 'wert_ungueltig');
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
      if (unterkonto) fachfehler('verboten', 'waehrung_nur_hauptkonto');
      // Jeder Wechsel stösst einen vollen Preislauf an.
      const takt = await zaehleAnfrage('waehrung', `konto:${userId}`, 60 * 60 * 1000);
      if (takt.count > 5) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: takt.waitMin });
    }
    if (unterkonto) return alt;
    const haushalt = await repo.eigenerHaushalt(tx, userId);
    if ((await repo.fremdGeteilt(tx, haushalt, waehrung)).length) {
      if (alt !== waehrung) fachfehler('konflikt', 'waehrung_geteiltes_unterkonto');
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
