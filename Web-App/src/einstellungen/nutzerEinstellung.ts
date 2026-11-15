import { sperreHaushaltswaehrung } from '../../db/txLock';
import { fachfehler } from '../infra/fehlerTexte';
import { imSystemkontext } from '../infra/kontoKontext';
import { ereignis } from '../infra/ereignis';
import { nutzerWertGueltig, schreibeNutzerEinstellung } from './settings';
import * as repo from './repository/waehrung';
import type { EinstellungenKontext } from './kontext';

const waehrungswechsel = (k: EinstellungenKontext) =>
  k.faecher.fach('waehrungswechsel', () => ereignis('waehrungswechsel'));
/** Die Finanzen liegen höher und horchen selbst (erzeugeFinanzen): Einstellungen kennen sie nicht. */
export function beiWaehrungswechsel(k: EinstellungenKontext, fn: () => unknown): () => void {
  return waehrungswechsel(k).horche(fn);
}

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

/** Für den ganzen Haushalt, sonst ergäben zwei Währungen eine falsche Summe; einladungEinloesen() sperrt ebenso. */
async function setzeHaushaltswaehrung(k: EinstellungenKontext, userId: number, waehrung: string) {
  // Über Enkel und fremde Hauptkonten (fremdGeteilt): weiter, als der Zeilenschutz reicht.
  const vorher = await imSystemkontext('haushaltswaehrung', () =>
    k.transaktion(async t => {
      await sperreHaushaltswaehrung(t.db);
      const alt = await repo.waehrungIn(t.db, userId);
      const unterkonto = await repo.hatHauptkonto(t.db, t.lesevertrag, userId);
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
      const haushalt = await repo.eigenerHaushalt(t.db, t.lesevertrag, userId);
      if ((await repo.fremdGeteilt(t.db, t.lesevertrag, haushalt, waehrung)).length) {
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
    setImmediate(() => void waehrungswechsel(k).melde());
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
