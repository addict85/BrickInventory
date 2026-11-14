import { sperreHaushaltswaehrung } from '../../db/txLock';
import { fachfehler } from '../infra/fehlerTexte';
import { imSystemkontext } from '../infra/kontoKontext';
import { nutzerWertGueltig, schreibeNutzerEinstellung } from './settings';
import * as repo from './repository/waehrung';
import type { EinstellungenKontext } from './kontext';

/** Die eine Schreibstelle: Ein Währungswechsel muss den Preis-Job anstossen,
 * weil der Preis-Cache je Währung verschlüsselt ist. */
export async function nutzerEinstellungSetzen(k: EinstellungenKontext, userId: number, key: string, value: unknown) {
  if (key !== 'currency') return schreibeNutzerEinstellung(k, userId, key, value);
  const v = String(value).trim();
  if (!nutzerWertGueltig(key, v)) fachfehler('ungueltig', 'wert_ungueltig');
  return setzeHaushaltswaehrung(k, userId, v);
}

/** Danach gilt die Vorgabe der Installation. */
export async function nutzerEinstellungLoeschen(k: EinstellungenKontext, userId: number, key: string) {
  await k.repository.loescheNutzerWert(userId, key);
}

/** Für den ganzen Haushalt: Zwei Währungen ergäben eine Summe, der man den
 * Fehler nicht ansieht. einladungEinloesen() prüft unter derselben Sperre. */
async function setzeHaushaltswaehrung(k: EinstellungenKontext, userId: number, waehrung: string) {
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
        const takt = await t.drossel.zaehleHoch(`waehrung|konto:${userId}`, 60);
        if ((parseInt(takt.count, 10) || 0) > 5)
          fachfehler('zu_viele', 'zu_viele_anfragen', {
            minuten: Math.max(1, Math.ceil(parseFloat(takt.wait_min) || 1)),
          });
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

export async function setzeEigenesDesign(k: EinstellungenKontext, userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) {
    await nutzerEinstellungLoeschen(k, userId, 'app_theme');
    return;
  }
  await nutzerEinstellungSetzen(k, userId, 'app_theme', v);
}
