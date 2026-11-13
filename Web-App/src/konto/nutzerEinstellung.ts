import { sperreHaushaltswaehrung } from '../../db/txLock';
import { nutzerWertGueltig } from '../einstellungen';
import { fachfehler } from '../infra/fehlerTexte';
import { zaehleAnfrage } from './loginLimiter';
import * as repo from './repository/waehrung';
import { imSystemkontext } from '../infra/kontoKontext';
import type { KontoKontext } from './kontext';

/** Die eine Schreibstelle: Ein Währungswechsel muss den Preis-Job anstossen,
 * weil der Preis-Cache je Währung verschlüsselt ist. */
export async function setUserSetting(k: KontoKontext, userId: number, key: string, value: unknown) {
  if (key !== 'currency') return k.einstellungen.schreibeNutzerEinstellung(userId, key, value);
  const v = String(value).trim();
  if (!nutzerWertGueltig(key, v)) fachfehler('ungueltig', 'wert_ungueltig');
  return setzeHaushaltswaehrung(k, userId, v);
}

/** Für den ganzen Haushalt: Zwei Währungen ergäben eine Summe, der man den
 * Fehler nicht ansieht. einladungEinloesen() prüft unter derselben Sperre. */
async function setzeHaushaltswaehrung(k: KontoKontext, userId: number, waehrung: string) {
  // Der Haushalt reicht hier über Enkel und fremde Hauptkonten (fremdGeteilt):
  // weiter als der Zeilenschutz, der nur direkte Unterkonten freigibt.
  const vorher = await imSystemkontext('haushaltswaehrung', () =>
    k.transaktion(async t => {
      await sperreHaushaltswaehrung(t.db);
      const alt = await repo.waehrungIn(t.db, userId);
      const unterkonto = await repo.hatHauptkonto(t.db, userId);
      if (alt !== waehrung) {
        if (unterkonto) fachfehler('verboten', 'waehrung_nur_hauptkonto');
        // Jeder Wechsel stösst einen vollen Preislauf an.
        const takt = await zaehleAnfrage(t, 'waehrung', `konto:${userId}`, 60 * 60 * 1000);
        if (takt.count > 5) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: takt.waitMin });
      }
      if (unterkonto) return alt;
      const haushalt = await repo.eigenerHaushalt(t.db, userId);
      if ((await repo.fremdGeteilt(t.db, haushalt, waehrung)).length) {
        if (alt !== waehrung) fachfehler('konflikt', 'waehrung_geteiltes_unterkonto');
        return alt;
      }
      await repo.setzeWaehrungFuer(t.db, haushalt, waehrung);
      return alt;
    }),
  );
  if (vorher !== waehrung) {
    console.log(
      `[settings] Währung für Benutzer ${userId} und seinen Haushalt geändert (${vorher ?? '—'} → ${waehrung}) — Preis-Job wird angestossen`,
    );
    setImmediate(() => k.nacharbeit.preisJobAnstossen());
  }
}

export async function setzeEigenesDesign(k: KontoKontext, userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) {
    await k.einstellungen.deleteUserSetting(userId, 'app_theme');
    return;
  }
  await setUserSetting(k, userId, 'app_theme', v);
}
