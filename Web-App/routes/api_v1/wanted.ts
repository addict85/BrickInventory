/** /api/v1/wanted — die Merkliste. Die Regeln stehen in src/merkliste/; hier
 * nur Blickfeld, Schreibrecht und Fehlerübersetzung. */
import type express from 'express';
import { oeffentlicherFehler } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken, kontoSchranke, sichtVon } from './middleware';
import { wacheUeberZugang } from '../../src/konto/http/zugangsWache';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { haushalt } from '../../src/haushalt';
import {
  legeMerkpostenAn,
  loescheMerkposten,
  verschiebeMerkposten,
  uebernimm,
  merkpostenVon,
  preiseBeiderZustaende,
  type Korrektur,
} from '../../src/merkliste';
import { getSetting } from '../../src/einstellungen';
import { csvEmpfang, xmlEmpfang } from '../../src/http/dateiEmpfang';
import { importAlsAuftrag, WantedKorrekturen, type ImportEingabe } from '../../src/auftraege';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import type { z } from 'zod';
import type { WantedXmlErgebnis } from '../../src/vertrag/merkliste';

import { jsonOderNull } from '../../src/infra/validate';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
const router = vertragsRouter();
type WantedXmlBericht = Pick<
  z.infer<typeof WantedXmlErgebnis>,
  'vorschau' | 'gelesen' | 'angelegt' | 'aufgestockt' | 'fehler' | 'posten' | 'offen'
>;

// Blickfeld wie überall: Wer ein Geschenk sucht, sieht die Merkposten der Enkel.
router.get('/wanted', requireToken, async (req: Anfrage<'GET /api/v1/wanted'>, res: Antwort<'GET /api/v1/wanted'>) => {
  const ids = sichtVon(req);
  // Die Währung des LESERS; price_cache ist je Währung verschlüsselt, deshalb
  // gehört sie in die Abfrage.
  const waehrung = await getSetting(req.apiUser.user_id, 'currency', 'EUR');
  const merkposten = await merkpostenVon(ids, undefined, waehrung, {
    suche: req.abfrage.search,
    zustand: req.abfrage.condition,
    sortierung: req.abfrage.sort,
  });
  const { eintraege, ...seite } = seiteAus(merkposten, req.abfrage);
  res.json({ success: true, merkposten: eintraege, ...seite });
});

/** Alle drei Wege (Katalog, Setnummer, Barcode) landen hier, damit die Regeln
 * nicht vom Weg abhängen. */
router.post(
  '/wanted',
  requireToken,
  async (req: Anfrage<'POST /api/v1/wanted'>, res: Antwort<'POST /api/v1/wanted'>) => {
    const { set_number, condition, owner_user_id } = req.eingabe;
    if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
    const owner = await haushalt.schreibziel(req.apiUser.user_id, owner_user_id);
    const { merkposten, war_neu } = await legeMerkpostenAn(owner, set_number, condition);
    res.json({ success: true, war_neu, merkposten });
  },
);

// Zwei Kontenprüfungen: heraus aus dem einen UND hinein ins andere Konto.
router.put(
  '/wanted/:setNumber/:condition/inhaber',
  requireToken,
  async (
    req: Anfrage<'PUT /api/v1/wanted/:setNumber/:condition/inhaber'>,
    res: Antwort<'PUT /api/v1/wanted/:setNumber/:condition/inhaber'>,
  ) => {
    const von = await haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const zu = await haushalt.schreibziel(req.apiUser.user_id, req.eingabe.neuer_inhaber);
    const r = await verschiebeMerkposten(von, req.pfad.setNumber, req.pfad.condition, zu);
    res.json({ success: true, ...r, owner_user_id: zu });
  },
);

/** Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set kann
 * neu UND gebraucht gewünscht sein. */
router.delete(
  '/wanted/:setNumber/:condition',
  requireToken,
  async (
    req: Anfrage<'DELETE /api/v1/wanted/:setNumber/:condition'>,
    res: Antwort<'DELETE /api/v1/wanted/:setNumber/:condition'>,
  ) => {
    const owner = await haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner_user_id);
    const weg = await loescheMerkposten(owner, req.pfad.setNumber, req.pfad.condition);
    res.json({ success: true, geloescht: weg });
  },
);

/** BEIDE Zustände, frisch geholt. */
router.get(
  '/wanted/:setNumber/preise',
  requireToken,
  async (
    req: Anfrage<'GET /api/v1/wanted/:setNumber/preise'>,
    res: Antwort<'GET /api/v1/wanted/:setNumber/preise'>,
  ) => {
    const sn = req.pfad.setNumber;
    const preise = await preiseBeiderZustaende(req.apiUser.user_id, sn);
    res.json({ success: true, set_number: sn, ...preise });
  },
);

/** Die Regel steht in merkliste.ts:uebernimm(); hier bleibt nur, wer schreiben darf. */
router.post(
  '/wanted/:setNumber/:condition/uebernehmen',
  requireToken,
  async (
    req: Anfrage<'POST /api/v1/wanted/:setNumber/:condition/uebernehmen'>,
    res: Antwort<'POST /api/v1/wanted/:setNumber/:condition/uebernehmen'>,
  ) => {
    const owner = await haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const r = await uebernimm(req.apiUser.user_id, owner, req.pfad.setNumber, req.pfad.condition, req.eingabe ?? {});
    res.json({ success: true, ...r });
  },
);

/** Das Gegenstück zu buildMerklisteCsv(). */
router.post(
  '/wanted/import/csv',
  requireToken,
  kontoSchranke('upload'),
  csvEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/wanted/import/csv'>, res: Antwort<'POST /api/v1/wanted/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const owner = await haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);

    res.json({
      success: true,
      ...(await importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'merkliste_csv', {
        owner,
        text: req.file.buffer.toString('utf-8'),
      })),
    });
  },
);

/** Korrekturen als Feld der Multipart-Anfrage: Bei 224 Posten wäre die Adresse
 * länger als jeder Proxy durchlässt. @returns null, wenn sie ungültig sind */
function korrekturenAus(roh: string | undefined): Korrektur[] | undefined | null {
  if (roh === undefined || roh.trim() === '') return undefined;
  const geparst = WantedKorrekturen.safeParse(jsonOderNull(roh)?.wert);
  return geparst.success ? geparst.data : null;
}

/** Die Zwischenstände als NDJSON-Zeilen. Endet der Zugang, endet der Strom; der
 * Auftrag läuft als eigener weiter. Die Kopfzeilen sind hinaus: Ein Fehler kommt
 * als letzte ZEILE, sonst wartet der Client auf einen Bericht, der nie kommt. */
async function importImStrom(
  req: express.Request,
  res: express.Response,
  uid: number,
  eingabe: ImportEingabe<'wanted_xml'>,
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
  const wache = wacheUeberZugang(req, () => {
    zeile({ success: false, error: fehlerText('zugang_beendet', antwortSprache(req)), code: 'zugang_beendet' });
    res.end();
  });
  await importAlsAuftrag(uid, 'wanted_xml', eingabe, { fortschritt: f => zeile({ fortschritt: f }) }).then(
    r => zeile({ success: true, ...r }),
    (e: unknown) => zeile({ success: false, ...oeffentlicherFehler(e, 'wanted-import:strom', req) }),
  );
  wache();
  if (!res.writableEnded) res.end();
}

/** Die Vorschau ist die VORGABE: Ohne `schreiben=1` wird nichts angelegt, weil
 * die dritte Sicherheitsstufe der Abbildung nur eine Vermutung ist. Gerechnet
 * wird im Auftrag (src/sammlung/wantedXmlImport.ts); mit `strom=1` gehen dessen
 * Zwischenstände als NDJSON-Zeilen hinaus, ohne als eine JSON-Antwort (App). */
router.post(
  '/wanted-list/import/xml',
  requireToken,
  kontoSchranke('upload'),
  xmlEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/wanted-list/import/xml'>, res: Antwort<'POST /api/v1/wanted-list/import/xml'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const xml = req.file.buffer.toString('utf-8');
    // Ohne <INVENTORY> keine Wanted-Liste — eine bessere Auskunft als „0 Posten".
    if (!/<INVENTORY[\s>]/i.test(xml)) return sendeFehler(req, res, 422, 'keine_wanted_liste');
    const korrekturen = korrekturenAus(req.eingabe.korrekturen);
    if (korrekturen === null) return sendeFehler(req, res, 400, 'korrekturen_ungueltig');
    const eingabe = {
      xml,
      dateiName: String(req.file.originalname || 'wanted.xml').slice(0, 120),
      schreiben: req.abfrage.schreiben ?? false,
      ueberRebrickable: req.abfrage.rebrickable ?? false,
      ...(korrekturen ? { korrekturen } : {}),
    };
    const uid = req.apiUser.user_id;
    if (!req.abfrage.strom)
      return res.json({ success: true, ...(await importAlsAuftrag<WantedXmlBericht>(uid, 'wanted_xml', eingabe)) });

    await importImStrom(req, res, uid, eingabe);
  },
);

router.use(fehlerAntwort);

export default router;
