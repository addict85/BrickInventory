/** /api/v1/wanted — the wanted list. The rules sit in src/wanted/; here
 * nur Blickfeld, Schreibrecht und Fehlerübersetzung. */
import type express from 'express';
import { publicError } from '../../src/infra/fehler';
import { kontoSchranke, viewOf, guardFor } from './middleware';
import { watchViaAccess } from '../../src/konto/http/zugangsWache';
import { errorText, responseLanguage, fachfehler } from '../../src/infra/fehlerTexte';
import type { Korrektur } from '../../src/wanted';
import { csvReceive, xmlReceive } from '../../src/http/dateiEmpfang';
import { WantedCorrections, type ImportInput } from '../../src/collection';
import type { CsvImportReport } from '../../src/infra/csvExport';
import type { z } from 'zod';
import type { WantedXmlErgebnis } from '../../src/vertrag/merkliste';

import { jsonOrNull } from '../../src/infra/validate';
import { pageFrom } from '../../src/infra/seite';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
type WantedXmlReport = Pick<
  z.infer<typeof WantedXmlErgebnis>,
  'vorschau' | 'gelesen' | 'angelegt' | 'aufgestockt' | 'fehler' | 'posten' | 'offen'
>;

/** Korrekturen als Feld der Multipart-Anfrage: Bei 224 Posten wäre die Adresse
 * länger als jeder Proxy durchlässt. @returns null, wenn sie ungültig sind */
function correctionsFrom(roh: string | undefined): Korrektur[] | undefined | null {
  if (roh === undefined || roh.trim() === '') return undefined;
  const geparst = WantedCorrections.safeParse(jsonOrNull(roh)?.wert);
  return geparst.success ? geparst.data : null;
}

/** Die Zwischenstände als NDJSON-Zeilen. Endet der Zugang, endet der Strom; der
 * Auftrag läuft als eigener weiter. Die Kopfzeilen sind hinaus: Ein Fehler kommt
 * als letzte ZEILE, sonst wartet der Client auf einen Bericht, der nie kommt. */
async function importInStream(
  d: Pick<Dienste, 'settings' | 'household' | 'konto' | 'wanted' | 'collection'>,
  req: express.Request,
  res: express.Response,
  uid: number,
  eingabe: ImportInput<'wanted_xml'>,
) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Für Proxys, die ihrerseits puffern (nginx & Verwandte).
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const zeile = (o: unknown) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(o) + '\n');
    (res as unknown as { flush?: () => void }).flush?.();
  };
  const wache = watchViaAccess(d.konto, req, () => {
    zeile({ success: false, error: errorText('zugang_beendet', responseLanguage(req)), code: 'zugang_beendet' });
    res.end();
  });
  await d.collection.runImport(uid, 'wanted_xml', eingabe, { fortschritt: f => zeile({ fortschritt: f }) }).then(
    r => zeile({ success: true, ...r }),
    (e: unknown) => zeile({ success: false, ...publicError(e, 'wanted-import:strom', req) }),
  );
  wache();
  if (!res.writableEnded) res.end();
}

export function buildWantedRouter(d: Pick<Dienste, 'settings' | 'household' | 'konto' | 'wanted' | 'collection'>) {
  const { requireToken } = guardFor(d.konto);
  const router = vertragsRouter('/api/v1');

  // Blickfeld wie überall: Wer ein Geschenk sucht, sieht die Merkposten der Enkel.
  router.endpunkt('GET /api/v1/wanted', requireToken, async req => {
    const ids = viewOf(req);
    // Die Währung des LESERS; price_cache ist je Währung verschlüsselt, deshalb
    // gehört sie in die Abfrage.
    const waehrung = await d.settings.userValue(req.apiUser.user_id, 'currency', 'EUR');
    const merkposten = await d.wanted.wantedItemsOf(ids, undefined, waehrung, {
      search: req.abfrage.search,
      condition: req.abfrage.condition,
      sort: req.abfrage.sort,
    });
    const { eintraege, ...seite } = pageFrom(merkposten, req.abfrage);
    return { merkposten: eintraege, ...seite };
  });

  /** Alle drei Wege (Katalog, Setnummer, Barcode) landen hier, damit die Regeln
   * nicht vom Weg abhängen. */
  router.endpunkt('POST /api/v1/wanted', requireToken, async req => {
    const { set_number, condition, owner_user_id } = req.eingabe;
    if (!set_number) fachfehler('ungueltig', 'set_number_erforderlich');
    const owner = await d.household.schreibziel(req.apiUser.user_id, owner_user_id);
    const { merkposten, war_neu } = await d.wanted.addWantedItem(owner, set_number, condition);
    return { war_neu, merkposten };
  });

  // Zwei Kontenprüfungen: heraus aus dem einen UND hinein ins andere Konto.
  router.endpunkt('PUT /api/v1/wanted/:setNumber/:condition/inhaber', requireToken, async req => {
    const von = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const zu = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.neuer_inhaber);
    const r = await d.wanted.moveWantedItem(von, req.pfad.setNumber, req.pfad.condition, zu);
    return { ...r, owner_user_id: zu };
  });

  /** Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set kann
   * neu UND gebraucht gewünscht sein. */
  router.endpunkt('DELETE /api/v1/wanted/:setNumber/:condition', requireToken, async req => {
    const owner = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner_user_id);
    const weg = await d.wanted.removeWantedItem(owner, req.pfad.setNumber, req.pfad.condition);
    return { geloescht: weg };
  });

  /** BEIDE Zustände, frisch geholt. */
  router.endpunkt('GET /api/v1/wanted/:setNumber/preise', requireToken, async req => {
    const sn = req.pfad.setNumber;
    const preise = await d.wanted.pricesForBothConditions(req.apiUser.user_id, sn);
    return { set_number: sn, ...preise };
  });

  /** Die Regel steht in wanted.ts:fulfillWantedItem(); hier bleibt nur, wer schreiben darf. */
  router.endpunkt('POST /api/v1/wanted/:setNumber/:condition/uebernehmen', requireToken, async req => {
    const owner = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const r = await d.wanted.fulfillWantedItem(
      req.apiUser.user_id,
      owner,
      req.pfad.setNumber,
      req.pfad.condition,
      req.eingabe ?? {},
    );
    return { ...r };
  });

  /** Das Gegenstück zu wantedListCsv(). */
  router.endpunkt(
    'POST /api/v1/wanted/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      const owner = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);

      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'merkliste_csv', {
          owner,
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  /** Die Vorschau ist die VORGABE: Ohne `schreiben=1` wird nichts angelegt, weil
   * die dritte Sicherheitsstufe der Abbildung nur eine Vermutung ist. Gerechnet
   * wird im Auftrag (src/collection/wantedXmlImport.ts); mit `strom=1` gehen dessen
   * Zwischenstände als NDJSON-Zeilen hinaus, ohne als eine JSON-Antwort (App). */
  router.endpunkt(
    'POST /api/v1/wanted-list/import/xml',
    requireToken,
    kontoSchranke('upload'),
    xmlReceive.single('file'),
    async (req, res) => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      const xml = req.file.buffer.toString('utf-8');
      // Ohne <INVENTORY> keine Wanted-Liste — eine bessere Auskunft als „0 Posten".
      if (!/<INVENTORY[\s>]/i.test(xml)) fachfehler('nicht_verarbeitbar', 'keine_wanted_liste');
      const korrekturen = correctionsFrom(req.eingabe.korrekturen);
      if (korrekturen === null) fachfehler('ungueltig', 'korrekturen_ungueltig');
      const eingabe = {
        xml,
        fileName: String(req.file.originalname || 'wanted.xml').slice(0, 120),
        schreiben: req.abfrage.schreiben ?? false,
        viaRebrickable: req.abfrage.rebrickable ?? false,
        ...(korrekturen ? { korrekturen } : {}),
      };
      const uid = req.apiUser.user_id;
      if (!req.abfrage.strom) return { ...(await d.collection.runImport<WantedXmlReport>(uid, 'wanted_xml', eingabe)) };

      await importInStream(d, req, res, uid, eingabe);
    },
  );
  return router;
}
