import * as db from '../db/database';
import type { WantedArt } from './wantedListe';

/**
 * Den WEG ZURÜCK bauen: aus dem Bestand eine BrickLink-Wanted-Liste.
 *
 * ── Marcos Frage vom 19.10. ─────────────────────────────────────────────────
 *
 *   „Kannst du auch prüfen ob es nicht eine api mit bricklink gibt damit die
 *    wanted listen direkt gelesen und Importiert werden können oder aus den
 *    Teileliste direkt die Teile in eine existierende oder neue wanted list
 *    exportiert werden können"
 *
 * Geprüft: Die BrickLink-Store-API (api.bricklink.com/api/store/v1, dieselbe,
 * die clients/bricklink.ts für Preise anspricht) hat KEINE Wanted-Listen. Sie
 * führt Bestellungen, Ladeninventar, Katalog, Preisführer, Farben,
 * Kategorien, Feedback, Coupons, Mitglied und Item-Mapping — nichts
 * dergleichen. Keine der verbreiteten Bibliotheken kennt solche Endpunkte,
 * der API-Changelog nennt keine, und im BrickLink-Forum steht ein Wunsch vom
 * Dezember 2024, der genau sie fordert.
 *
 * Der dokumentierte Weg ist der MASSEN-UPLOAD: BrickLink nimmt eine Datei im
 * eigenen XML-Format an (Hilfe 207 und 2567). Genau die baut diese Datei.
 *
 * ── Das Format, und die drei Stellen, an denen man es falsch macht ──────────
 *
 * Pflicht:   ITEMTYPE, ITEMID, COLOR, MINQTY
 * optional:  MAXPRICE, QTYFILLED, CONDITION, REMARKS, WANTEDSHOW,
 *            WANTEDLISTID, NOTIFY
 *
 * 1. KEINE XML-Deklaration. BrickLink weist eine Datei mit
 *    `<?xml version="1.0"?>` ab — unsere eigenen Testvorlagen in
 *    test/wanted-liste-db.test.js tragen eine, weil sie den LESER füttern,
 *    und der verträgt beides. Für den Upload muss sie weg.
 * 2. `WANTEDLISTID` leer heisst „Standardliste". Gesetzt heisst „genau diese
 *    bestehende Liste" — das ist Marcos „existierende oder neue".
 * 3. Höchstens 204 800 Bytes je Upload. Bei 2000 Posten ist das erreichbar,
 *    deshalb schneidet [baueWantedXmlStuecke] in Stücke, statt eine Datei zu
 *    liefern, die BrickLink wortlos ablehnt.
 *
 * ── Was NICHT erfunden wird ─────────────────────────────────────────────────
 *
 * Eine Farbe, die keine BrickLink-Nummer hat, wird NICHT geschrieben. Das ist
 * dieselbe Regel wie beim Import, nur spiegelbildlich: Dort hat `color_id: 0`
 * ein Teil als schwarz erfunden (Marcos Befund vom 19.10.), hier wäre eine
 * geratene BrickLink-Farbe ein Posten, den er in der falschen Farbe kauft.
 * Solche Zeilen kommen in `ohneFarbe` zurück und werden GENANNT.
 */

/** Ein Posten, wie BrickLink ihn haben will. */
export interface XmlPosten {
  art: WantedArt;
  /** Die BrickLink-Nummer. */
  blId: string;
  /** Die BrickLink-Farbnummer — null bei Sets und Figuren. */
  blFarbe: number | null;
  menge: number;
  /** 'N' | 'U' — alles andere wird weggelassen („egal"). */
  zustand?: string | null;
  /** Wandert als REMARKS mit, z. B. der Lagerort. */
  notiz?: string | null;
}

/** BrickLinks Artencodes — die Gegenrichtung zu ARTEN in wantedListe.ts. */
const CODES: Record<WantedArt, string> = { part: 'P', fig: 'M', set: 'S' };

/**
 * Höchstgrösse eines Uploads, in Bytes (BrickLink-Hilfe 207:
 * „maximum file size allowed for upload is 204800 bytes").
 *
 * Ausgeschrieben und benannt, damit die Zahl EINMAL dasteht: Sie taucht in
 * der Stückelung und in ihrem Test auf, und eine Zahl in zwei Kopien läuft
 * auseinander.
 */
export const BL_UPLOAD_MAX_BYTES = 204_800;

/**
 * XML-Sonderzeichen. `&` zuerst, sonst verdoppelt es die folgenden.
 *
 * `xmlEsc` und nicht `esc`: utils/mailer.ts hat ein `esc` für HTML, und
 * test/namen-eindeutig.test.js hat die Doppelung gemeldet. Die beiden sind
 * sich ÄHNLICH, aber nicht gleich — hier kommt `&apos;` dazu, weil XML es
 * kennt und HTML nicht in jedem Kontext. Ein gemeinsamer Helfer müsste den
 * Unterschied als Schalter tragen; zwei klar benannte Funktionen sagen mehr.
 */
function xmlEsc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Ein `<ITEM>`-Block. */
function item(p: XmlPosten, wantedListId?: string | null): string {
  const zeilen = [
    `<ITEMTYPE>${CODES[p.art]}</ITEMTYPE>`,
    `<ITEMID>${xmlEsc(p.blId)}</ITEMID>`,
  ];
  // COLOR gehört zu Teilen. Für ein Set oder eine Figur wäre sie sinnlos, und
  // eine 0 dort hiesse bei BrickLink „not applicable" — also lieber nichts.
  if (p.blFarbe !== null) zeilen.push(`<COLOR>${p.blFarbe}</COLOR>`);
  zeilen.push(`<MINQTY>${Math.max(1, Math.round(p.menge))}</MINQTY>`);
  // CONDITION nur, wenn sie etwas sagt. BrickLink kennt N, U und X („egal");
  // X ist die Vorgabe, und sie hinzuschreiben ist dasselbe wie sie
  // weglassen — nur länger.
  if (p.zustand === 'N' || p.zustand === 'U') zeilen.push(`<CONDITION>${p.zustand}</CONDITION>`);
  if (p.notiz) zeilen.push(`<REMARKS>${xmlEsc(p.notiz)}</REMARKS>`);
  if (wantedListId) zeilen.push(`<WANTEDLISTID>${xmlEsc(wantedListId)}</WANTEDLISTID>`);
  return `<ITEM>\n${zeilen.map(z => '  ' + z).join('\n')}\n</ITEM>`;
}

/**
 * Eine Liste als BrickLink-XML — als EIN Stück, ohne Rücksicht auf die Grösse.
 *
 * Für den Normalfall und für Tests. Wer hochlädt, nimmt
 * [baueWantedXmlStuecke].
 */
export function baueWantedXml(posten: XmlPosten[], wantedListId?: string | null): string {
  // Keine XML-Deklaration — siehe Punkt 1 im Dateikopf.
  return `<INVENTORY>\n${posten.map(p => item(p, wantedListId)).join('\n')}\n</INVENTORY>\n`;
}

/**
 * Dieselbe Liste, aber in Stücke geschnitten, die BrickLink annimmt.
 *
 * Gemessen wird in BYTES und nicht in Zeichen: Ein Lagerort „Kiste Grün" wird
 * in UTF-8 zu mehr Bytes als er Zeichen hat, und die Grenze ist eine
 * Bytegrenze. `Buffer.byteLength` statt `.length` ist hier tragend.
 *
 * Ein einzelner Posten, der allein schon zu gross ist, kann nicht geteilt
 * werden; er bekommt sein eigenes Stück, und das ist dann eben zu gross. Das
 * zu verschweigen wäre schlimmer: BrickLink lehnt ab, und niemand wüsste,
 * woran es lag.
 */
export function baueWantedXmlStuecke(
  posten: XmlPosten[], wantedListId?: string | null, grenze = BL_UPLOAD_MAX_BYTES,
): string[] {
  if (!posten.length) return [baueWantedXml([], wantedListId)];
  const RUMPF = Buffer.byteLength('<INVENTORY>\n\n</INVENTORY>\n');
  const stuecke: string[] = [];
  let aktuell: XmlPosten[] = [];
  let bytes = RUMPF;
  for (const p of posten) {
    const b = Buffer.byteLength(item(p, wantedListId)) + 1;   // +1 für das \n
    if (aktuell.length && bytes + b > grenze) {
      stuecke.push(baueWantedXml(aktuell, wantedListId));
      aktuell = []; bytes = RUMPF;
    }
    aktuell.push(p); bytes += b;
  }
  if (aktuell.length) stuecke.push(baueWantedXml(aktuell, wantedListId));
  return stuecke;
}

/** Ein Posten, der nicht mitkonnte. */
export interface OhneFarbe {
  blId: string;
  farbe: number;
  farbName: string | null;
  menge: number;
}

/**
 * Was die Farbübersetzung übrig lässt.
 *
 * `ohneFarbe` wird GENANNT und nicht stillschweigend ausgelassen — sonst
 * fehlen die Posten in der Wanted-Liste, und beim Vergleich mit der
 * Teileliste fällt es erst beim Zählen auf.
 */
export interface FarbErgebnis {
  posten: XmlPosten[];
  ohneFarbe: OhneFarbe[];
}

/**
 * Die Rebrickable-Farbnummern auf BrickLink abbilden.
 *
 * Aus `rb_colors.bl_color_id` — dieselbe Spalte, aus der der Import die
 * Gegenrichtung liest. Eine Farbe ohne Eintrag kommt als `undefined` zurück,
 * NICHT als 0: Die 0 ist bei BrickLink „not applicable" und bei Rebrickable
 * SCHWARZ, und beides zu verwechseln hat am 19.10. schon einen Bestand
 * verdorben.
 */
async function blFarbkarte(farben: number[]): Promise<Map<number, number>> {
  if (!farben.length) return new Map();
  const zeilen = await db.all(
    'SELECT id, bl_color_id FROM rb_colors WHERE id = ANY($1) AND bl_color_id IS NOT NULL',
    [[...new Set(farben)]]).catch(() => []);
  return new Map(zeilen.map(z => [Number(z.id), Number(z.bl_color_id)]));
}

/** Die Farbbezeichnungen — nur für die Meldung über das, was fehlt. */
async function farbNamen(farben: number[]): Promise<Map<number, string | null>> {
  if (!farben.length) return new Map();
  const zeilen = await db.all('SELECT id, name FROM rb_colors WHERE id = ANY($1)',
    [[...new Set(farben)]]).catch(() => []);
  return new Map(zeilen.map(z => [Number(z.id), z.name ?? null]));
}

/**
 * Aus Teilezeilen eine Wanted-Liste.
 *
 * ── Woher die Zeilen kommen, und warum das die richtige Quelle ist ──────────
 *
 * Aus `getParts()` — derselben Funktion, die den Teile-Reiter füllt. Damit
 * exportiert Marco GENAU, was er vor sich sieht, Filter und Suche
 * eingeschlossen: Er stellt die Liste ein und drückt auf Exportieren. Eine
 * eigene Abfrage daneben hätte dieselbe Gruppierung, dieselben Mengenregeln
 * und dieselben Katalog-Verbindungen nachbauen müssen — und wäre beim
 * nächsten Umbau auseinandergelaufen.
 *
 * `part_number` aus getParts IST schon die BrickLink-Nummer
 * (`blNummerSql(...) AS part_number`): Die Zuordnung hält nur die ABWEICHUNG
 * fest, kein Eintrag heisst „heisst dort genauso". Auf der Nummernseite gibt
 * es hier also nichts nachzusehen; die Lücke sitzt bei der FARBE.
 *
 * @param menge  woraus die MINQTY wird. Vorgabe: die Stückzahl im Bestand.
 */
export function teileZuXmlPosten(
  zeilen: { part_number: string; color_id: number | null; total_quantity?: number | null;
            storage?: string | null }[],
  opt: { mitLagerort?: boolean } = {},
): XmlPosten[] {
  return zeilen.map(z => ({
    art: 'part' as WantedArt,
    blId: String(z.part_number),
    blFarbe: z.color_id === null || z.color_id === undefined ? null : Number(z.color_id),
    menge: Number(z.total_quantity ?? 1) || 1,
    ...(opt.mitLagerort && z.storage ? { notiz: z.storage } : {}),
  }));
}

/**
 * Die Farben übersetzen und trennen, was nicht mitkann.
 *
 * Eigene Funktion und nicht in [teileZuXmlPosten] eingebaut: Die Übersetzung
 * braucht die Datenbank, das Umformen nicht — und ein Test kann das Umformen
 * damit ohne Datenbank prüfen.
 */
export async function uebersetzeFarben(posten: XmlPosten[]): Promise<FarbErgebnis> {
  const farben = posten.filter(p => p.blFarbe !== null).map(p => p.blFarbe as number);
  const karte = await blFarbkarte(farben);
  const ohneFarbe: OhneFarbe[] = [];
  const fehlende: number[] = [];
  const fertig: XmlPosten[] = [];
  for (const p of posten) {
    if (p.blFarbe === null) { fertig.push(p); continue; }
    // Farbe 0 ist im Baum „ohne Angabe" und bei BrickLink „not applicable" —
    // beides heisst: keine COLOR schreiben. Das ist kein Mangel, also auch
    // keine Meldung.
    if (p.blFarbe === 0) { fertig.push({ ...p, blFarbe: null }); continue; }
    const bl = karte.get(p.blFarbe);
    if (bl === undefined) { fehlende.push(p.blFarbe); ohneFarbe.push(
      { blId: p.blId, farbe: p.blFarbe, farbName: null, menge: p.menge }); continue; }
    fertig.push({ ...p, blFarbe: bl });
  }
  // Die Namen erst jetzt, und nur für das, was fehlt: eine Abfrage statt einer
  // je Zeile, und bei einer vollständigen Karte gar keine.
  if (ohneFarbe.length) {
    const namen = await farbNamen(fehlende);
    for (const o of ohneFarbe) o.farbName = namen.get(o.farbe) ?? null;
  }
  return { posten: fertig, ohneFarbe };
}
