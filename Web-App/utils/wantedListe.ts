/**
 * BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Ich möchte auch Bricklink-Wanted-Listen importieren können. Diese sollen
 *    dann als manuell erfasste Parts und Minifiguren oder sets importiert
 *    werden. Anbei habe ich dir ein XML. Bitte beachte dass im xml BL-IDs und
 *    nicht Rebrickable-IDs enthalten sind."
 *
 * Und zur Reihenfolge: „Zuerst die restlichen … mit der Option diese über
 * Bricklink oder noch besser über Rebrickable versuchen aufzulösen."
 *
 * ── Was an Marcos Datei GEMESSEN wurde ──────────────────────────────────────
 *
 * 224 Posten, alle ITEMTYPE=P, alle CONDITION=X, alle MAXPRICE=-1.0000, alle
 * NOTIFY=N. 24 verschiedene BL-Farben. Die Teilenummern: 203 rein numerisch,
 * 16 Ziffern+Buchstaben, 4 bedruckt (pb/pr), eine mit x-Präfix.
 *
 * Sets und Minifiguren kommen in dieser Datei NICHT vor. Die Codes dafür (S
 * und M) stehen hier aus BrickLinks Artenliste, nicht aus Marcos Datei — das
 * ist der einzige Teil dieses Lesers, der sich an seinem Beispiel nicht
 * prüfen lässt, und er steht deshalb hier ausdrücklich.
 *
 * ── Warum über eine DATEI und nicht über die BrickLink-API ──────────────────
 *
 * Marcos Frage vom 19.10.: „Kannst du auch prüfen ob es nicht eine api mit
 * bricklink gibt damit die wanted listen direkt gelesen und Importiert werden
 * können".
 *
 * Geprüft, und die Antwort ist nein. Die BrickLink-Store-API
 * (api.bricklink.com/api/store/v1 — dieselbe, die clients/bricklink.ts für
 * Preise anspricht, mit denselben vier Zugangsdaten) führt Bestellungen,
 * Ladeninventar, Katalog, Preisführer, Farben, Kategorien, Feedback, Coupons,
 * Mitglied und Item-Mapping. WANTED-LISTEN SIND NICHT DABEI.
 *
 * Drei unabhängige Belege, die in dieselbe Richtung zeigen: Keine der
 * verbreiteten Bibliotheken (Python, C#, Java, der Rust-Nachbau) kennt solche
 * Endpunkte; der API-Changelog nennt keine; und in BrickLinks Forum steht ein
 * Wunsch vom Dezember 2024, der genau sie fordert. Anbieter, die
 * „get_wanted_lists" bewerben, verlangen dafür eine SITZUNG mit dem
 * BrickLink-Login — das ist Abgreifen, nicht die API.
 *
 * Die Prüfung hatte eine Grenze, und die gehört dazu: bricklink.com war aus
 * der Arbeitsumgebung gesperrt (getaddrinfo ENOTFOUND), die Doku-Seite selbst
 * liess sich also nicht öffnen. Das obige stützt sich auf übereinstimmende
 * Zweitquellen.
 *
 * Darum bleibt der Weg, den Marco ohnehin geht: die Liste bei BrickLink als
 * XML herunterladen und hier einlesen. Wer diese Frage erneut stellt, möge
 * zuerst nachsehen, ob sich seit Oktober 2026 etwas geändert hat.
 *
 * ── Warum ohne XML-Bibliothek ───────────────────────────────────────────────
 *
 * Eine Wanted-Liste ist flach: <INVENTORY> mit <ITEM>-Kindern, in jedem
 * höchstens ein Dutzend Textfelder, keine Attribute, keine Verschachtelung.
 * Dafür eine Abhängigkeit aufzunehmen wäre mehr, als die Sache trägt — anders
 * als bei den PDFs, wo das Messen ergeben hat, dass es ohne nicht geht.
 *
 * Gelesen wird je ITEM-Block und NICHT über die ganze Datei: Sonst gewinnt
 * beim Zählen der erste Treffer, und aus 224 Posten würde einer. (Genau diese
 * Form hat in diesem Baum schon zweimal etwas falsch gemacht — siehe
 * seitenweiseLesen in utils/gutscheinPdfSchreiben.ts.)
 */
import * as db from '../db/database';
import { nutzerStandardZustand } from './settings';

/** Die drei Arten, die diese Anwendung führt. */
export type WantedArt = 'part' | 'fig' | 'set';

/**
 * BrickLinks Artencodes, soweit sie hier etwas bedeuten.
 *
 * P, S und M sind die drei, die einen Platz im Bestand haben. B (Book),
 * G (Gear), C (Catalog), I (Instruction), O (Original Box) und U (Unsorted
 * Lot) führt diese Anwendung nicht — sie werden GEZÄHLT und gemeldet, nicht
 * stillschweigend verworfen: Wer eine Liste mit Zubehör hochlädt, soll lesen,
 * dass davon etwas liegengeblieben ist.
 */
const ARTEN: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

/** Ein Posten, wie er in der Datei steht — noch ganz in BrickLink-Begriffen. */
export interface WantedPosten {
  art: WantedArt;
  /** ITEMID — eine BrickLink-Nummer, KEINE Rebrickable-Nummer. */
  blId: string;
  /** COLOR als BrickLink-Farbnummer; null bei Sets und farblosen Posten. */
  blFarbe: number | null;
  /** MINQTY, mindestens 1. */
  menge: number;
  /** CONDITION: N oder U; X („egal") wird zu null. */
  zustand: 'N' | 'U' | null;
  /** MAXPRICE; -1 heisst „kein Höchstpreis" und wird null. */
  maxPreis: number | null;
}

/** Ein Textfeld aus einem ITEM-Block. */
function feld(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  // Die fünf vordefinierten Entitäten. Mehr kommt in einer Wanted-Liste nicht
  // vor; käme etwas, bliebe es stehen und fiele auf, statt still falsch zu
  // werden. &amp; ZULETZT — sonst würde aus „&amp;lt;" ein „<".
  return (m[1] ?? '').trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface LeseErgebnis {
  posten: WantedPosten[];
  /** Posten mit einer Art, die diese Anwendung nicht führt — je Code gezählt. */
  fremdeArten: Record<string, number>;
  /** ITEM-Blöcke ohne ITEMID. */
  ohneNummer: number;
}

/**
 * Eine Wanted-Liste lesen.
 *
 * Wirft NICHT bei fremden Arten oder fehlenden Feldern: Eine Liste, die zu
 * neun Zehnteln brauchbar ist, soll zu neun Zehnteln ankommen. Was nicht
 * geht, steht im Ergebnis.
 */
export function leseWantedListe(xml: string): LeseErgebnis {
  const posten: WantedPosten[] = [];
  const fremdeArten: Record<string, number> = {};
  let ohneNummer = 0;

  const blockRe = /<ITEM>([\s\S]*?)<\/ITEM>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const typ = (feld(block, 'ITEMTYPE') ?? '').toUpperCase();
    const art = ARTEN[typ];
    const blId = feld(block, 'ITEMID');

    if (!blId) { ohneNummer++; continue; }
    if (!art) { fremdeArten[typ || '(ohne)'] = (fremdeArten[typ || '(ohne)'] ?? 0) + 1; continue; }

    const farbeRoh = feld(block, 'COLOR');
    const farbe = farbeRoh === null ? null : parseInt(farbeRoh, 10);
    const mengeRoh = parseInt(feld(block, 'MINQTY') ?? '1', 10);
    const zustandRoh = (feld(block, 'CONDITION') ?? '').toUpperCase();
    const preisRoh = parseFloat(feld(block, 'MAXPRICE') ?? '');

    posten.push({
      art,
      blId,
      // Farbe 0 ist bei BrickLink „(Not Applicable)" und keine Farbe. Bei
      // Sets steht ohnehin keine.
      blFarbe: farbe !== null && Number.isFinite(farbe) && farbe > 0 ? farbe : null,
      menge: Number.isFinite(mengeRoh) && mengeRoh > 0 ? mengeRoh : 1,
      // X heisst „egal". Als null weitergegeben, damit darüber die Einstellung
      // des Kontos entscheidet und nicht diese Datei — dieselbe Regel wie beim
      // Merklisten-Import.
      zustand: zustandRoh === 'N' || zustandRoh === 'U' ? zustandRoh : null,
      // -1.0000 heisst „kein Höchstpreis". Der Wert ist ohnehin kein
      // Kaufpreis, sondern eine Preisgrenze beim Suchen — er wird NICHT als
      // Kaufpreis übernommen (siehe die Begründung an der Route).
      maxPreis: Number.isFinite(preisRoh) && preisRoh > 0 ? preisRoh : null,
    });
  }

  return { posten, fremdeArten, ohneNummer };
}

/** Wie sicher eine Zuordnung ist. */
export type Sicherheit =
  /** bl_zuordnung kennt die Nummer ausdrücklich. */
  | 'zuordnung'
  /** bl_zuordnung sagt „keine abweichende Nummer" (bl_id IS NULL). */
  | 'gleich_vermerkt'
  /** Die Nummer steht so im Rebrickable-Katalog — niemand hat BrickLink dazu
   *  nachgesehen. WAHRSCHEINLICH, nicht sicher. */
  | 'katalogtreffer'
  /**
   * Rebrickable hat die Abbildung geliefert UND sie bestätigt: Der Treffer
   * trägt die gesuchte Nummer in external_ids.BrickLink. Das ist so sicher wie
   * Stufe 1, nur frisch geholt statt gespeichert — und deshalb eine eigene
   * Stufe, damit im Bericht steht, was ein Abruf gekostet hat.
   */
  | 'rebrickable'
  /**
   * Der Mensch hat sie in der Vorschau EINGETRAGEN.
   *
   * Eine eigene Stufe und nicht 'zuordnung': Dort steht etwas, das im Katalog
   * nachgesehen wurde; hier steht, was Marco von Hand hingeschrieben hat.
   * Beide sind so gut wie ihre Quelle, aber sie haben verschiedene Quellen —
   * und der Bericht soll nicht behaupten, der Katalog habe geliefert, was
   * jemand getippt hat.
   */
  | 'korrigiert';

export interface Aufloesung {
  posten: WantedPosten;
  /** Die Rebrickable-Nummer — null, wenn lokal nichts zu finden war. */
  rbId: string | null;
  /** Die Rebrickable-Farbnummer — null bei Sets und wenn nichts zu finden war. */
  rbFarbe: number | null;
  /**
   * Name und Farbwert zur Nummer — beide aus rb_colors.
   *
   * Sie reisen MIT, statt spaeter nachgeschlagen zu werden: Der Anleger
   * schreibt `color_name` an die Zeile, und die Teileliste liest den Namen
   * von dort. Bis zum 19.10. wurden sie nicht uebergeben; der Hex-Wert fiel
   * in der Anzeige auf den Katalog zurueck, der NAME nicht. Marcos Befund:
   * ein Farbpunkt ohne Beschriftung.
   */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  /** Woher die Nummer kommt. */
  sicherheit: Sicherheit | null;
  /** Die Farbe liess sich nicht abbilden, die Nummer schon. */
  farbeOffen: boolean;
}

/**
 * Lokal auflösen — ohne jeden Abruf bei einem fremden Dienst.
 *
 * ── Die drei Stufen, und warum sie getrennt bleiben ─────────────────────────
 *
 * 1. `bl_zuordnung.bl_id = X` — jemand hat die abweichende Nummer eingetragen.
 *    Das ist eine Abbildung, kein Schluss.
 * 2. `bl_zuordnung.rb_id = X AND bl_id IS NULL` — jemand hat nachgesehen und
 *    vermerkt: keine abweichende Nummer. Also ist die BL-Nummer die
 *    RB-Nummer. Auch das ist eine Abbildung (Migration 0037 erklärt diesen
 *    NULL-Wert ausdrücklich).
 * 3. Die Nummer steht so im Rebrickable-Katalog. Das ist WAHRSCHEINLICH
 *    richtig — bei den meisten Teilen benutzen beide Dienste dieselbe Nummer
 *    —, aber es hat niemand nachgesehen. Es gibt Nummern, die bei BrickLink
 *    etwas anderes bezeichnen als bei Rebrickable.
 *
 * Die drei zusammenzuwerfen wäre bequem und würde Stufe 3 wie eine Abbildung
 * aussehen lassen. Sie bleibt deshalb getrennt und wird in der Vorschau
 * einzeln gezählt — Marco entscheidet, ob er sie nimmt.
 *
 * Die FARBE kommt aus rb_colors.bl_color_id. Das ist katalogweit gepflegt und
 * kennt keine Stufen: entweder die Zuordnung steht da oder nicht.
 */
export async function loeseLokalAuf(posten: WantedPosten[]): Promise<Aufloesung[]> {
  if (!posten.length) return [];

  // Alles in DREI Abfragen statt in 224: Eine Abfrage je Posten wäre bei
  // Marcos Datei 672 Rundläufe zur Datenbank.
  const nummern = [...new Set(posten.map(p => p.blId))];
  const farben = [...new Set(posten.map(p => p.blFarbe).filter((f): f is number => f !== null))];

  const zuordnung = new Map<string, { rbId: string; sicherheit: Sicherheit }>();
  for (const z of await db.all(
    `SELECT art, rb_id, bl_id FROM bl_zuordnung
      WHERE (bl_id = ANY($1) OR (bl_id IS NULL AND rb_id = ANY($1)))`, [nummern])
    .catch(() => [])) {
    const schluessel = `${z.art}:${z.bl_id ?? z.rb_id}`;
    // Eine ausdrückliche Zuordnung gewinnt gegen einen NULL-Vermerk.
    const stufe: Sicherheit = z.bl_id ? 'zuordnung' : 'gleich_vermerkt';
    const schon = zuordnung.get(schluessel);
    if (!schon || (schon.sicherheit !== 'zuordnung' && stufe === 'zuordnung')) {
      zuordnung.set(schluessel, { rbId: z.rb_id, sicherheit: stufe });
    }
  }

  // Stufe 3 je Art im eigenen Katalog.
  const katalog = new Set<string>();
  for (const [art, sql] of [
    ['part', 'SELECT part_number AS n FROM part_catalog WHERE part_number = ANY($1)'],
    ['fig',  'SELECT fig_number AS n FROM minifigs_catalog WHERE fig_number = ANY($1)'],
    ['set',  'SELECT set_number AS n FROM set_catalog WHERE set_number = ANY($1)'],
  ] as const) {
    for (const z of await db.all(sql, [nummern]).catch(() => [])) katalog.add(`${art}:${z.n}`);
  }

  const farbMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await db.all(
    'SELECT id, name, rgb, bl_color_id FROM rb_colors WHERE bl_color_id = ANY($1)', [farben]).catch(() => [])) {
    farbMap.set(Number(z.bl_color_id), {
      id: Number(z.id), name: z.name ?? null, hex: z.rgb ?? null,
    });
  }

  return posten.map((p) => {
    const treffer = zuordnung.get(`${p.art}:${p.blId}`);
    let rbId: string | null = null;
    let sicherheit: Sicherheit | null = null;
    if (treffer) { rbId = treffer.rbId; sicherheit = treffer.sicherheit; }
    else if (katalog.has(`${p.art}:${p.blId}`)) { rbId = p.blId; sicherheit = 'katalogtreffer'; }

    const farbe = p.blFarbe === null ? null : (farbMap.get(p.blFarbe) ?? null);
    return {
      posten: p, rbId, rbFarbe: farbe?.id ?? null,
      rbFarbName: farbe?.name ?? null, rbFarbHex: farbe?.hex ?? null,
      sicherheit,
      farbeOffen: rbId !== null && p.blFarbe !== null && farbe === null,
    };
  });
}

/**
 * Die offenen Posten über Rebrickable auflösen.
 *
 * ── Marcos Vorgabe zur Reihenfolge ──────────────────────────────────────────
 *
 *   „Zuerst die restlichen … mit der Option diese über Bricklink oder noch
 *    besser über Rebrickable versuchen aufzulösen."
 *
 * „Noch besser über Rebrickable" ist nicht nur besser, sondern der einzige
 * DIREKTE Weg: BrickLink kennt keine Rebrickable-Nummern. Über BrickLink
 * ginge nur ein Umweg (Posten abfragen, Name und Alternativnummern holen, die
 * bei Rebrickable suchen) — zwei Sprünge mit je eigener Fehlerquelle. Deshalb
 * steht hier Rebrickable und nicht beides; käme der Umweg, wäre er eine
 * eigene Funktion und keine stillere Hälfte dieser.
 *
 * ── Nur die OFFENEN, und nur auf Verlangen ──────────────────────────────────
 *
 * Jeder Abruf kostet aus Marcos Tageskontingent. Angefragt wird deshalb
 * ausschliesslich, was lokal nichts ergab — bei seiner Datei wären das die
 * Posten, die `loeseLokalAuf` offen lässt, nicht alle 224.
 *
 * Teile allein: Für Figuren und Sets führt Rebrickable keine BrickLink-IDs in
 * external_ids (die Notiz steht in utils/bricklinkLink.ts: „Rebrickable hat
 * external_ids nur bei Parts"). Eine Abfrage dafür wäre ein Abruf, der nichts
 * finden KANN.
 */
/**
 * Wie weit ist der Import? — für den Balken in der Oberfläche.
 *
 * ── Marcos Wunsch vom 20.10. ────────────────────────────────────────────────
 *
 * „kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
 *  anzeigen?"
 *
 * Zwei Phasen, weil zwei verschiedene Dinge dauern — und die eine dauert
 * ungleich länger:
 *
 *   rebrickable  Die offenen Nummern bei Rebrickable nachfragen. Jeder Abruf
 *                geht durch die Hintergrunddrossel: EINE Anfrage je 1,5
 *                Sekunden (utils/rateLimiter.ts). Fünfzig offene Posten sind
 *                also über eine Minute, in der ohne Balken nichts passiert.
 *   schreiben    Die Posten in den Bestand legen. Je Posten ein paar
 *                Abfragen, dazu beim ersten Mal die Katalogpflege.
 *
 * `gesamt` ist die Zahl, die für DIESE Phase gilt — bei `rebrickable` die der
 * offenen Teile, bei `schreiben` die aller Posten. Ein gemeinsamer Nenner über
 * beide Phasen wäre eine Zahl, die niemand nachrechnen kann; zwei ehrliche
 * Abschnitte sind besser als ein geschätzter Balken.
 */
export type WantedFortschritt = {
  phase: 'rebrickable' | 'schreiben';
  fertig: number;
  gesamt: number;
};

export async function loeseUeberRebrickableAuf(
  auf: Aufloesung[], grenze = 250,
  fortschritt?: (stand: WantedFortschritt) => void,
): Promise<{ auf: Aufloesung[]; gefragt: number; gefunden: number; filterWirkungslos: boolean }> {
  const { blTeilZuRb, blFilterWirkungslos } = require('../clients/rebrickable');
  let gefragt = 0, gefunden = 0;

  const ergebnis = [...auf];
  // Wie viele Abrufe es HÖCHSTENS werden. Genau die Bedingungen der Schleife
  // darunter, sonst zählt der Balken gegen eine andere Zahl als er füllt.
  const gesamt = Math.min(grenze,
    ergebnis.filter(a => a.rbId === null && a.posten.art === 'part').length);
  for (let i = 0; i < ergebnis.length; i++) {
    const a = ergebnis[i]!;
    if (a.rbId !== null) continue;
    if (a.posten.art !== 'part') continue;
    if (gefragt >= grenze) break;

    gefragt++;
    let rbId: string | null = null;
    // Ein Abruf, der scheitert (Netz, Kontingent, 500), beendet NICHT den
    // ganzen Lauf: Die übrigen Posten sind davon unberührt, und ein Import,
    // der an Posten 150 von 224 abbricht, lässt den Nutzer im Dunkeln.
    try { rbId = await blTeilZuRb(a.posten.blId); } catch { rbId = null; }
    if (rbId) {
      gefunden++;
      ergebnis[i] = { ...a, rbId, sicherheit: 'rebrickable' };
    }
    // NACH dem Abruf melden, nicht davor: „37 von 50" soll heissen, dass 37
    // erledigt sind — nicht, dass der 37. gerade anfängt.
    fortschritt?.({ phase: 'rebrickable', fertig: gefragt, gesamt });
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos() };
}

/**
 * Was aus einem Posten geworden ist.
 *
 * ── Warum hier Bild und Name mitreisen (Marcos Vorschau) ───────────────────
 *
 *   „noch besser wäre wenn es beim Import die zu importierende Liste
 *    vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
 *    Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
 *    rebrickable ids ergänzen könnte"
 *
 * Eine Vorschau, die nur Nummern zeigt, ist keine. Wer 224 Posten prüfen
 * soll, erkennt am BILD in einer Sekunde, dass Posten 57 der falsche Stein
 * ist — an „3001 → 3001, katalogtreffer" erkennt er es nie.
 *
 * Die Beschreibung kommt aus den KATALOGEN dieses Baums, ohne jeden Abruf
 * (siehe beschreibePosten). Was dort fehlt, bleibt leer statt geraten.
 */
export interface PostenErgebnis {
  blId: string;
  art: WantedArt;
  /** Die BrickLink-Farbnummer aus der Datei — die Vorschau zeigt sie an. */
  blFarbe: number | null;
  menge: number;
  zustand: string | null;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  /** 'angelegt' | 'aufgestockt' | 'offen' | 'fehler' */
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
  /**
   * Derselbe Grund als Kennung, für die Oberfläche.
   *
   * `grund` ist ein deutscher Satz — richtig fürs Protokoll, falsch in einer
   * englischen Tabelle. Die Kennung lässt die Oberfläche den Text in der
   * Sprache des Betrachters setzen; `blFarbe` steht in der Zeile und kann
   * dort eingesetzt werden.
   *
   * Ein Fehler beim Anlegen hat keine Kennung: Dort steht die Meldung der
   * Ausnahme, und die lässt sich nicht in Fälle einteilen.
   */
  grundCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Beschreibung aus dem Katalog — leer, wenn er die Nummer nicht kennt. */
  name?: string | null;
  bild?: string | null;
  /**
   * Name und Bild wurden unter der BRICKLINK-Nummer gefunden, nicht über eine
   * Abbildung. Die Oberfläche muss das kennzeichnen — siehe beschreibePosten.
   */
  nameGeraten?: boolean;
  farbName?: string | null;
  farbHex?: string | null;
}

/**
 * Eine Korrektur aus der Vorschau.
 *
 * ── Warum der INDEX und nicht die Nummer ────────────────────────────────────
 *
 * Eine Wanted-Liste darf denselben Posten zweimal enthalten (Marcos Datei hat
 * 3001 in 24 Farben, und BrickLink hindert niemanden daran, ihn in derselben
 * Farbe zweimal aufzuführen). Ein Schlüssel aus Art, Nummer und Farbe träfe
 * dann zwei Zeilen, und die Korrektur landete auf der falschen — oder auf
 * beiden.
 *
 * Der Index ist eindeutig, weil der Leser die Datei in einer festen Reihen-
 * folge zerlegt (leseWantedListe geht Posten für Posten durch). Damit er
 * nicht ins Leere zeigt, wenn zwischen Vorschau und Schreiben eine ANDERE
 * Datei gewählt wurde, reisen Art und Nummer als Gegenprobe mit: Stimmen sie
 * nicht, wird die Korrektur abgewiesen statt angewandt.
 */
export interface Korrektur {
  index: number;
  /** Gegenprobe — muss zu dem Posten an [index] passen. */
  blId: string;
  art: WantedArt;
  rbId?: string | null;
  rbFarbe?: number | null;
}

export interface WantedBericht {
  gelesen: number;
  fremdeArten: Record<string, number>;
  ohneNummer: number;
  /** Wie viele Posten je Sicherheitsstufe aufgelöst wurden. */
  stufen: Record<string, number>;
  /** Posten mit Nummer, aber ohne abbildbare Farbe. */
  farbeOffen: number;
  /** Nicht aufgelöst — mit ihren BrickLink-Nummern, damit man sie nachsehen kann. */
  offen: { blId: string; art: WantedArt; blFarbe: number | null }[];
  /** Nur gesetzt, wenn über Rebrickable gefragt wurde. */
  rebrickable?: { gefragt: number; gefunden: number; filterWirkungslos: boolean };
  /**
   * Nur gesetzt, wenn Korrekturen mitkamen.
   *
   * `abgewiesen` ist nicht leer, wenn eine Korrektur auf einen Posten zeigte,
   * der dort nicht steht — dann wurde zwischen Vorschau und Schreiben eine
   * andere Datei gewählt. Sie wird GENANNT und nicht übergangen.
   */
  korrekturen?: { angewandt: number; abgewiesen: Korrektur[] };
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  /** true = es wurde NICHTS geschrieben. */
  vorschau: boolean;
  /**
   * true = jemand hat abgebrochen, der Rest der Liste blieb liegen.
   *
   * Steht nur dann da. Die Zahlen oben (angelegt/aufgestockt/fehler) gelten
   * für das, was BIS dahin geschehen ist — und das bleibt stehen.
   */
  abgebrochen?: boolean;
  /**
   * Der Standardzustand des Kontos — fuer die Vorschau.
   *
   * ── Marcos Bitte vom 20.10. ───────────────────────────────────────────────
   *
   *   „ja, bitte die Zustandsspalte noch in die Vorschau"
   *
   * Je Posten steht der Zustand AUS DER DATEI (`zustand`), und der ist bei
   * CONDITION=X und bei fehlender Angabe null — dann gilt der Standard des
   * Kontos. Die Vorschau soll aber zeigen, was ANGELEGT wird, nicht was in der
   * Datei steht.
   *
   * Aufgeloest wird der Zustand erst beim Schreiben (zustandFuerPreis in
   * utils/settings.ts). In der Vorschau ist er noch nicht gefallen — deshalb
   * reist der Standard EINMAL je Bericht mit, nicht je Posten: Er ist je Konto
   * derselbe, und 224-mal dieselbe Zeichenkette waere eine Abschrift.
   *
   * Warum nicht im Browser nachschlagen: Dort steht er nirgends verlaesslich
   * (initDefaultCondition in 01-core.js setzt nur die Formularfelder). Der
   * Server weiss ihn sicher; ein geratener Zustand in einer Vorschau waere
   * genau die Sorte Behauptung, die hier schon einmal falsch war.
   */
  standardZustand: 'N' | 'U';
  posten: PostenErgebnis[];
}

/**
 * Zu jedem aufgelösten Posten Name, Bild und Farbbezeichnung holen.
 *
 * ── Woraus, und was NICHT ───────────────────────────────────────────────────
 *
 * Aus den Katalogen dieses Baums, in DREI Abfragen für die ganze Liste (eine
 * je Art) — nicht eine je Posten. Marcos Datei hat 224 Zeilen; 224 Abfragen
 * wären eine Vorschau, auf die man wartet.
 *
 * Je Art zwei Quellen, in dieser Reihenfolge:
 *
 *   Teile    part_catalog / part_color_catalog  (hier gepflegt, mit Bild je
 *            Teil UND Farbe), sonst rb_parts    (aus dem CSV-Abgleich)
 *   Figuren  minifigs_catalog,                  sonst nichts
 *   Sets     set_catalog,                       sonst rb_sets
 *
 * Kein Abruf bei Rebrickable oder BrickLink: Die Vorschau soll SOFORT da sein
 * und auch ohne Netz etwas zeigen. Was der Katalog nicht kennt, bleibt leer —
 * eine leere Zelle ist eine ehrliche Auskunft, ein geratener Name nicht.
 *
 * Das Farbbild haengt an Teil UND Farbe (ein roter 2x4 sieht anders aus als
 * ein blauer, siehe merkeTeilFarbe); gibt es keines fuer diese Farbe, faellt
 * es auf das allgemeine Teilebild zurueck.
 *
 * ── Auch fuer die OFFENEN Posten, und warum das trotzdem ehrlich ist ───────
 *
 * Ein Posten ohne Rebrickable-Nummer wird unter seiner BRICKLINK-Nummer
 * nachgesehen. Das ist keine Abbildung und wird auch nicht als eine
 * ausgegeben: `geraten: true` sagt es, die Zeile bleibt `offen`, und ihr
 * Grund bleibt stehen.
 *
 * Es ist aber genau die Auskunft, die Marco zum Entscheiden braucht. Steht in
 * der Zeile „9999 — (nichts bekannt)", kann er nur raten; steht dort
 * „9999 — Brick 2 x 2 (Name unter der BrickLink-Nummer gefunden)", sieht er,
 * worum es geht und kann die Nummer eintragen. Die Information
 * wegzuwerfen, weil sie nicht aus einer Abbildung stammt, hilft niemandem —
 * sie muss nur als das dastehen, was sie ist.
 */
export async function beschreibePosten(
  auf: Aufloesung[],
): Promise<Map<number, { name: string | null; bild: string | null; geraten: boolean }>> {
  const raus = new Map<number, { name: string | null; bild: string | null; geraten: boolean }>();

  // Die Nummern je Art sammeln. Ohne Rebrickable-Nummer gilt die
  // BrickLink-Nummer als Schluessel — siehe oben.
  const teile: { i: number; nr: string; farbe: number | null; geraten: boolean }[] = [];
  const figuren: { i: number; nr: string; geraten: boolean }[] = [];
  const sets: { i: number; nr: string; geraten: boolean }[] = [];
  auf.forEach((a, i) => {
    const nr = a.rbId ?? a.posten.blId;
    const geraten = a.rbId === null;
    if (!nr) return;
    if (a.posten.art === 'part') teile.push({ i, nr, farbe: a.rbFarbe, geraten });
    else if (a.posten.art === 'fig') figuren.push({ i, nr, geraten });
    else sets.push({ i, nr, geraten });
  });

  if (teile.length) {
    const nummern = [...new Set(teile.map(t => t.nr))];
    const zeilen = await db.all(`
      SELECT p.part_number,
             COALESCE(pc.part_name, rp.name)        AS name,
             COALESCE(rp.part_img_url, '')          AS bild_allgemein
        FROM (SELECT UNNEST($1::text[]) AS part_number) p
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN rb_parts     rp ON rp.part_num    = p.part_number`,
      [nummern]).catch(() => []);
    const nachNummer = new Map(zeilen.map(z => [z.part_number, z]));
    // Die Farbbilder in EINER Abfrage: (Nummer, Farbe) als Paare.
    const paare = teile.filter(t => t.farbe !== null);
    const bilder = new Map<string, string>();
    if (paare.length) {
      const farbZeilen = await db.all(`
        SELECT part_number, color_id, COALESCE(image_local, image_url) AS bild
          FROM part_color_catalog
         WHERE (part_number, color_id) IN (
                 SELECT UNNEST($1::text[]), UNNEST($2::int[]))`,
        [paare.map(t => t.nr), paare.map(t => t.farbe)]).catch(() => []);
      for (const z of farbZeilen) if (z.bild) bilder.set(`${z.part_number}|${z.color_id}`, z.bild);
    }
    for (const t of teile) {
      const z = nachNummer.get(t.nr);
      const name = z?.name ?? null;
      const bild = bilder.get(`${t.nr}|${t.farbe}`) || z?.bild_allgemein || null;
      // `geraten` nur dann, wenn ueberhaupt etwas gefunden wurde: Eine leere
      // Zeile „geraten" zu nennen waere eine Behauptung ueber nichts.
      raus.set(t.i, { name, bild, geraten: t.geraten && !!(name || bild) });
    }
  }

  if (figuren.length) {
    const zeilen = await db.all(
      `SELECT fig_number, fig_name, COALESCE(image_local, image_url) AS bild
         FROM minifigs_catalog WHERE fig_number = ANY($1)`,
      [[...new Set(figuren.map(f => f.nr))]]).catch(() => []);
    const nach = new Map(zeilen.map(z => [z.fig_number, z]));
    for (const f of figuren) {
      const z = nach.get(f.nr);
      const name = z?.fig_name ?? null, bild = z?.bild ?? null;
      raus.set(f.i, { name, bild, geraten: f.geraten && !!(name || bild) });
    }
  }

  if (sets.length) {
    const nummern = [...new Set(sets.map(x => x.nr))];
    const zeilen = await db.all(`
      SELECT s.set_number,
             COALESCE(sc.name, rs.name)                                AS name,
             COALESCE(sc.image_local, sc.image_url, rs.set_img_url)     AS bild
        FROM (SELECT UNNEST($1::text[]) AS set_number) s
        LEFT JOIN set_catalog sc ON sc.set_number = s.set_number
        LEFT JOIN rb_sets     rs ON rs.set_num    = s.set_number`,
      [nummern]).catch(() => []);
    const nach = new Map(zeilen.map(z => [z.set_number, z]));
    for (const x of sets) {
      const z = nach.get(x.nr);
      const name = z?.name ?? null, bild = z?.bild ?? null;
      raus.set(x.i, { name, bild, geraten: x.geraten && !!(name || bild) });
    }
  }

  return raus;
}

/**
 * Die Korrekturen aus der Vorschau auf die Auflösung legen.
 *
 * Jede wird GEGENGEPRÜFT: Art und BrickLink-Nummer am angegebenen Index
 * müssen passen. Sonst wurde zwischen Vorschau und Schreiben eine andere
 * Datei gewählt, und die Korrektur würde auf einen fremden Posten wirken —
 * lautlos, denn beide Zahlen sähen plausibel aus.
 *
 * Eine abgewiesene Korrektur wird GEMELDET, nicht übergangen (siehe
 * `korrekturenAbgewiesen` im Bericht).
 */
function wendeKorrekturenAn(
  auf: Aufloesung[], korrekturen: Korrektur[],
): { auf: Aufloesung[]; angewandt: number; abgewiesen: Korrektur[] } {
  const ergebnis = [...auf];
  const abgewiesen: Korrektur[] = [];
  let angewandt = 0;
  for (const k of korrekturen) {
    const a = ergebnis[k.index];
    if (!a || a.posten.art !== k.art || a.posten.blId !== k.blId) { abgewiesen.push(k); continue; }
    // Nur was DASTEHT wird geändert: `undefined` heisst „nicht angefasst",
    // `null` heisst „ausdrücklich geleert". Ohne die Unterscheidung löschte
    // eine Korrektur, die nur die Farbe setzt, die Nummer mit.
    const rbId    = k.rbId    === undefined ? a.rbId    : (k.rbId || null);
    const rbFarbe = k.rbFarbe === undefined ? a.rbFarbe : (k.rbFarbe ?? null);
    if (rbId === a.rbId && rbFarbe === a.rbFarbe) continue;   // nichts geändert
    ergebnis[k.index] = {
      ...a, rbId, rbFarbe,
      // Der Name der Farbe gilt nicht mehr: Er gehoerte zur alten Nummer.
      // Er wird unten neu geholt (farbenNachtragen), damit die Zeile nicht
      // mit „Red" an einer blauen Farbnummer herausgeht.
      rbFarbName: rbFarbe === a.rbFarbe ? a.rbFarbName : null,
      rbFarbHex:  rbFarbe === a.rbFarbe ? a.rbFarbHex  : null,
      sicherheit: 'korrigiert',
      // Eine eingetragene Farbe ist nicht mehr offen.
      farbeOffen: rbId !== null && a.posten.blFarbe !== null && rbFarbe === null,
    };
    angewandt++;
  }
  return { auf: ergebnis, angewandt, abgewiesen };
}

/**
 * Farbbezeichnung und Farbwert zu den korrigierten Farben nachholen.
 *
 * Die Auflösung holt sie für die Farben aus der DATEI; eine von Hand
 * eingetragene Farbnummer war dort nicht dabei. Ohne diesen Schritt ginge sie
 * ohne Namen an den Anleger — und das ist genau der Farbpunkt ohne
 * Beschriftung, der am 19.10. behoben wurde.
 */
async function farbenNachtragen(auf: Aufloesung[]): Promise<Aufloesung[]> {
  const offen = auf.filter(a => a.rbFarbe !== null && a.rbFarbName === null)
                   .map(a => a.rbFarbe as number);
  if (!offen.length) return auf;
  const zeilen = await db.all(
    'SELECT id, name, rgb FROM rb_colors WHERE id = ANY($1)', [[...new Set(offen)]])
    .catch(() => []);
  const nach = new Map(zeilen.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbFarbe === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbFarbe);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}

/** Die Stufen zählen — eine Zeile, die sonst dreimal dastünde. */
function zaehleStufen(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/**
 * Eine Wanted-Liste einlesen — als Vorschau oder wirklich.
 *
 * ── Warum die Vorschau derselbe Weg ist ─────────────────────────────────────
 *
 * Sie liest, löst auf und zählt genau wie der Ernstfall; nur das Schreiben
 * bleibt aus. Zwei getrennte Wege hätten auseinanderlaufen können — und dann
 * verspräche die Vorschau etwas, das der Import nicht tut. Das ist die Sorte
 * Fehler, die niemand sieht, weil beide Zahlen plausibel aussehen.
 *
 * ── Was angelegt wird, und warum es HEREINGEGEBEN wird ──────────────────────
 *
 * „als manuell erfasste Parts und Minifiguren oder sets" — also über
 * addManualPart(), addManualFig() und addSet(), die drei Wege, die auch das
 * Formular benutzt. Kein eigenes INSERT: Dort hängen Lagerort, Preisregel,
 * Katalognachtrag und die Erfassungszeile dran, und jede Abschrift davon
 * verliert etwas (die Begründung steht an addManualPart).
 *
 * Nur: addManualPart und addManualFig liegen in routes/. Mein erster Entwurf
 * holte sie mit require('../routes/parts') hierher — und test/schichten.test.js
 * hat das abgewiesen: „Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE.
 * Die Funktion gehoert in die Schicht, die sie braucht — sonst zieht jeder
 * Nutzer den HTTP-Apparat mit."
 *
 * Die Ausnahmeliste dieses Tests ist LEER, und das ist ein erarbeiteter Stand
 * (der Kommentar dort sagt, dass zwei von acht Einträgen nur wegen eines
 * Fehlers in der Regel dastanden). Der erste neue Eintrag wäre ein
 * Rückschritt — also ist die Abhängigkeit umgedreht: Die ROUTE kennt die
 * Routen und gibt die drei Anleger herein. Diese Datei kennt nur ihre Form.
 *
 * ── Kein Kaufpreis ──────────────────────────────────────────────────────────
 *
 * MAXPRICE ist eine SUCHGRENZE („bis so viel würde ich zahlen"), kein
 * bezahlter Preis. Als Kaufpreis übernommen stünde in der Finanzansicht ein
 * Betrag, den niemand ausgegeben hat. Die Posten kommen deshalb ohne Preis
 * herein; was sie wert sind, holt der Marktpreis.
 */
/**
 * Die drei Anleger, die der Import braucht.
 *
 * Als Schnittstelle und nicht als Einfuhr: So kennt diese Datei nur die FORM
 * („etwas, das ein Teil anlegt") und nicht den Ort. Die Route steckt die
 * echten Funktionen hinein; ein Test könnte Zähler hineinstecken.
 *
 * Die Reihenfolge der Parameter folgt den echten Funktionen, damit das
 * Hereingeben eine Zuweisung bleibt und keine Übersetzung: addManualPart und
 * addManualFig nehmen (uid, body), addSet nimmt die Setnummer zuerst — daher
 * die eigene Form für `set`.
 */
export interface Anleger {
  teil: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  figur: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (uid: number, setNummer: string, menge: number,
        zustand: string | null) => Promise<unknown>;
}

export async function importiereWantedListe(
  uid: number, xml: string,
  opt: {
    vorschau?: boolean; ueberRebrickable?: boolean; anleger?: Anleger;
    /** Was der Mensch in der Vorschau geändert hat. */
    korrekturen?: Korrektur[];
    /**
     * Eine eingetragene Rebrickable-Nummer MERKEN.
     *
     * Hereingegeben und nicht hier gerufen — dieselbe Begründung wie beim
     * Anleger, nur milder: merkeBlNummer liegt unter utils/ und wäre von hier
     * aus erreichbar. Sie als Rückruf zu nehmen hält diese Funktion aber
     * schreibfrei bis auf den Anleger, und ein Test kann zählen, was gemerkt
     * wurde, ohne eine Datenbank dafür zu brauchen.
     *
     * Nur beim ECHTEN Import, nie in der Vorschau: Eine Vorschau, die etwas
     * speichert, ist keine.
     */
    merkeNummer?: (art: WantedArt, rbId: string, blId: string) => Promise<unknown>;
    /**
     * Wie weit es ist — für den Balken in der Oberfläche (siehe
     * WantedFortschritt). Wird SYNCHRON gerufen und darf nichts werfen; der
     * Aufrufer schreibt damit eine Zeile in seinen Strom.
     *
     * Hereingegeben und nicht hier geschrieben, aus demselben Grund wie beim
     * Anleger: Diese Funktion kennt keine HTTP-Antwort, und ein Test kann die
     * Meldungen einsammeln, ohne eine Leitung dafür zu brauchen.
     */
    fortschritt?: (stand: WantedFortschritt) => void;
    /**
     * „Soll ich aufhören?" — alle zehn Posten gefragt.
     *
     * Der Fortschritt steht seit dem 20.10. auch im Auftragsdatensatz, den
     * beide Oberflächen als Balken zeigen (utils/importAuftrag.ts), und dieser
     * Balken trägt ein Kreuz. Ein Import, der das Kreuz nicht beachtet, hätte
     * einen Abbrechen-Knopf, der lügt.
     *
     * Alle zehn Posten und nicht bei jedem: Die Frage ist eine Abfrage an die
     * Datenbank. Derselbe Takt wie beim CSV-Import (routes/sets.ts), und
     * dieselbe Zusage: Was schon angelegt ist, bleibt — Abbrechen nimmt nichts
     * zurück, es hört nur auf.
     */
    abbruch?: () => Promise<boolean>;
  } = {},
): Promise<WantedBericht> {
  const gelesen = leseWantedListe(xml);
  let auf = await loeseLokalAuf(gelesen.posten);

  let rebrickable: WantedBericht['rebrickable'];
  if (opt.ueberRebrickable) {
    const r = await loeseUeberRebrickableAuf(auf, 250, opt.fortschritt);
    auf = r.auf;
    rebrickable = { gefragt: r.gefragt, gefunden: r.gefunden,
                    filterWirkungslos: r.filterWirkungslos };
  }

  // ── Korrekturen NACH dem Auflösen, VOR dem Zählen ──────────────────────
  //
  // Nach dem Auflösen, weil sie es überstimmen sollen. Vor dem Zählen, weil
  // der Bericht sonst die Zahlen von vor der Korrektur nennt — und Marco
  // liest ihn, um zu entscheiden.
  let korrekturen: WantedBericht['korrekturen'];
  if (opt.korrekturen?.length) {
    const k = wendeKorrekturenAn(auf, opt.korrekturen);
    auf = await farbenNachtragen(k.auf);
    korrekturen = { angewandt: k.angewandt, abgewiesen: k.abgewiesen };
  }

  const bericht: WantedBericht = {
    gelesen: gelesen.posten.length,
    fremdeArten: gelesen.fremdeArten,
    ohneNummer: gelesen.ohneNummer,
    stufen: zaehleStufen(auf),
    farbeOffen: auf.filter(a => a.farbeOffen).length,
    offen: auf.filter(a => a.rbId === null)
              .map(a => ({ blId: a.posten.blId, art: a.posten.art, blFarbe: a.posten.blFarbe })),
    ...(rebrickable ? { rebrickable } : {}),
    ...(korrekturen ? { korrekturen } : {}),
    angelegt: 0, aufgestockt: 0, fehler: 0,
    vorschau: !!opt.vorschau,
    standardZustand: await nutzerStandardZustand(uid),
    posten: [],
  };

  let lfd = -1;
  /** Ein Posten ist durch. `lfd` zählt ab 0, der Balken ab 1. */
  const melde = () => opt.fortschritt?.(
    { phase: 'schreiben', fertig: lfd + 1, gesamt: auf.length });

  for (const a of auf) {
    // Alle zehn Posten nachsehen, ob jemand abgebrochen hat. Die Zählung geht
    // über `lfd`, also über ALLE Posten — auch die übersprungenen; sonst hinge
    // der Takt daran, wie viele Posten auflösbar waren.
    if (opt.abbruch && !opt.vorschau && lfd >= 0 && (lfd + 1) % 10 === 0) {
      if (await opt.abbruch()) { bericht.abgebrochen = true; break; }
    }
    // ── Eine Farbe, die sich nicht abbilden laesst, wird NICHT erfunden ────
    //
    // Marcos Befund vom 19.10.: „Die Farbe wurde nicht immer uebernommen und
    // die Teile sind nun mehrfach vorhanden (bsp 3001)."
    //
    // Hier stand `color_id: a.rbFarbe ?? 0`. Die 0 ist bei Rebrickable aber
    // SCHWARZ und nicht „keine Farbe" — die Warnung steht woertlich in
    // routes/parts.ts („fuer die Bildsuche fatal: 0 ist bei Rebrickable
    // SCHWARZ"). Ein Posten mit unbekannter Farbe landete damit als
    // schwarzes Teil im Bestand, NEBEN demselben Teil in seiner richtigen
    // Farbe. Das ist das Doppelte, das Marco sieht.
    //
    // NACHGESTELLT: Liste mit 3001 in BL-Farbe 5 (abbildbar) und BL-Farbe 85
    // (nicht abbildbar) ergab zwei Zeilen, color_id 4 und color_id 0.
    //
    // Der Bericht wusste es die ganze Zeit — `farbeOffen` zaehlt genau diese
    // Posten — und schrieb sie trotzdem. Jetzt bleiben sie OFFEN, mit Grund.
    // Damit fehlt der Posten im Bestand, statt falsch darin zu stehen; die
    // Vorschau (Stufe 3) gibt Marco die Gelegenheit, die Farbe zu setzen.
    // ── Der Grund kommt ZWEIMAL: als Satz und als Kennung ─────────────────
    //
    // Der Satz ist für das Protokoll und für jeden Aufrufer, der nur lesen
    // will. Die Kennung ist für die Oberfläche: Sie zeigt den Grund in der
    // Sprache des Betrachters, und ein deutscher Satz in einer englischen
    // Tabelle ist genau das, was dabei herauskam, bevor es sie gab (am
    // laufenden Server gesehen: „open / BrickLink-Farbe 85 ist im Katalog
    // keiner Rebrickable-Farbe zugeordnet" zwischen lauter englischen
    // Spalten).
    //
    // Dieselbe Teilung wie bei utils/fehlerTexte.ts: EINE Entscheidung, zwei
    // Sprachen am Rand.
    const grund = a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
    const grundCode: PostenErgebnis['grundCode'] = a.rbId === null
      ? 'nummer_unbekannt'
      : a.farbeOffen ? 'farbe_unbekannt' : undefined;
    // Eigene Bindung statt nur eines Wahrheitswerts: Der Pruefer verengt
    // `a.rbId` ueber eine Hilfsvariable NICHT, und `rbId` ist weiter unten als
    // `string` gebraucht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    lfd++;
    // Name und Bild kommen NACH der Schleife dazu — siehe dort, warum.
    const zeile: PostenErgebnis = {
      blId: a.posten.blId, art: a.posten.art,
      blFarbe: a.posten.blFarbe, menge: a.posten.menge, zustand: a.posten.zustand ?? null,
      rbId: a.rbId, rbFarbe: a.rbFarbe,
      sicherheit: a.sicherheit, ausgang: a.rbId === null ? 'offen' : 'angelegt',
      ...(grund ? { grund } : {}),
      ...(grundCode ? { grundCode } : {}),
      // Die Farbangaben stehen auch ohne Vorschau da — sie kosten nichts, die
      // Auflösung hat sie ohnehin geholt.
      farbName: a.rbFarbName, farbHex: a.rbFarbHex,
    };
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau steht „angelegt" fuer „wuerde angelegt" — geschrieben
      // wird nichts, und `vorschau: true` im Bericht sagt das.
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // Auch der übersprungene Posten ist ERLEDIGT. Zählte der Balken nur die
      // geschriebenen, bliebe er bei einer Liste mit vielen offenen Posten vor
      // dem Ende stehen — und sähe aus wie ein hängender Import.
      melde();
      continue;
    }

    try {
      if (!opt.anleger) throw new Error('Kein Anleger übergeben — siehe Anleger');
      let rueckmeldung: unknown;
      if (a.posten.art === 'part') {
        // `color_name`/`color_hex` reisen MIT. Ohne sie bleibt die Spalte
        // leer, und die Teileliste liest den Namen von dort — der Hex-Wert
        // faellt auf den Katalog zurueck, der Name NICHT. Ergebnis war ein
        // Farbpunkt ohne Beschriftung (Marcos Bildschirmfoto).
        //
        // `a.rbFarbe` ist hier nie null: Ein Posten ohne abbildbare Farbe ist
        // oben schon als offen ausgeschieden.
        rueckmeldung = await opt.anleger.teil(uid, {
          part_number: rbId,
          color_id: a.rbFarbe ?? 0,
          ...(a.rbFarbName ? { color_name: a.rbFarbName } : {}),
          ...(a.rbFarbHex ? { color_hex: a.rbFarbHex } : {}),
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
        });
      } else if (a.posten.art === 'fig') {
        rueckmeldung = await opt.anleger.figur(uid, {
          fig_number: rbId,
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
        });
      } else {
        rueckmeldung = await opt.anleger.set(uid, rbId, a.posten.menge, a.posten.zustand);
      }
      // Angelegt oder aufgestockt — der Anleger weiss es, und bis zum 19.10.
      // wurde es nicht gefragt: Ein zweiter Import derselben Liste meldete
      // `angelegt: 2, aufgestockt: 0`, obwohl beide Posten nur aufgestockt
      // wurden (nachgestellt). Die Zahl, die Marco liest, war falsch.
      const wieAngelegt = (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated';
      if (wieAngelegt) bericht.angelegt++; else bericht.aufgestockt++;
      zeile.ausgang = wieAngelegt ? 'angelegt' : 'aufgestockt';

      // ── Eine NACHGESCHLAGENE Nummer wird GEMERKT ──────────────────────
      //
      // Marcos Bitte war „rebrickable ids ergänzen" — und wer sie einmal
      // eingetragen hat, soll sie beim nächsten Import nicht wieder
      // eintippen. Gemerkt wird in bl_zuordnung; dort liest loeseLokalAuf
      // sie als Stufe 1 ('zuordnung') wieder, also als Abbildung und nicht
      // als Vermutung.
      //
      // ── Warum 'rebrickable' dazugehört (Marcos Frage vom 20.10.) ──────
      //
      //   „wenn das gleiche xml-File 2x importiere sollte der 2. Lauf massiv
      //    schneller sein korrekt?" … „Wieso wird das Mapping BL zu Rebr.
      //    nicht gespeichert?"
      //
      // Hier stand allein 'korrigiert', begründet mit: „Die anderen Stufen
      // kommen schon von dort oder aus dem Katalog." Das trifft auf drei der
      // vier anderen zu — 'zuordnung' und 'gleich_vermerkt' stehen schon in
      // bl_zuordnung, 'katalogtreffer' ist wirklich geraten. Auf
      // 'rebrickable' trifft KEINES von beidem zu: Sie steht nirgends, und
      // sie ist nicht geraten. Die Stufe ist beim Aufzählen schlicht unter
      // „die anderen" gefallen.
      //
      // GEMESSEN: dieselbe Datei zweimal importiert, mit einem Zähler auf
      // dem Rebrickable-Client. Lauf 1 zwei Abrufe, Lauf 2 noch EINER —
      // `blTeilZuRb 98765`, obwohl die Antwort beim ersten Mal schon dastand.
      // bl_zuordnung war nach beiden Läufen leer. Bei einer Liste mit 224
      // Posten kostet jeder weitere Lauf dieselben 1,5 Sekunden je Posten
      // mit abweichender Nummer, und jedes Mal aus dem Tageskontingent.
      //
      // Dass es eine Abbildung ist und keine Vermutung, steht an blTeilZuRb
      // selbst: „Jeder Treffer muss in seinen external_ids.BrickLink die
      // GESUCHTE Nummer tragen" — nachgeschlagen und gegengeprüft, nur von
      // Rebrickable statt von Hand.
      //
      // NICHT gemerkt wird weiterhin ein Posten, den auch Rebrickable nicht
      // auflösen konnte: Er steht gar nicht hier (er ist 'offen' und wird
      // nie angelegt), und ein „nachgesehen, nichts gefunden" kennt
      // bl_zuordnung nicht — die Tabelle führt Abbildungen, keine
      // Fehlanzeigen. Diese Posten kosten jeden Lauf erneut einen Abruf.
      //
      // Ein Fehlschlag hier bricht den Import nicht ab: Der Posten steht im
      // Bestand, und das ist die Hauptsache. Die Notiz ist Bequemlichkeit.
      if ((a.sicherheit === 'korrigiert' || a.sicherheit === 'rebrickable') && opt.merkeNummer) {
        await opt.merkeNummer(a.posten.art, rbId, a.posten.blId)
          .catch(() => { /* siehe oben */ });
      }
    } catch (e: unknown) {
      bericht.fehler++;
      zeile.ausgang = 'fehler';
      zeile.grund = e instanceof Error ? e.message : String(e);
    }
    bericht.posten.push(zeile);
    // Nach dem Anlegen UND nach einem Fehlschlag: Der Posten ist in beiden
    // Fällen abgearbeitet. Stünde die Meldung im try, bliebe der Balken bei
    // einer Liste mit Fehlern stehen.
    melde();
  }

  // ── Name und Bild an die Posten — IMMER, nicht nur in der Vorschau ───────
  //
  // ── Marcos Befund vom 21.10. ──────────────────────────────────────────────
  //
  //   „Nach dem XML-Import verschwinden die Bilder im Importdialog. vor und
  //    während dem Import sind diese sichtbar."
  //
  // Hier stand der Aufruf WEIT OBEN und nur für die Vorschau, begründet mit:
  // „Beim echten Import sieht sie niemand, und drei Abfragen über 224 Posten
  // umsonst zu machen wäre eine Verzögerung ohne Gegenwert."
  //
  // Die Annahme war falsch. Der Dialog bleibt nach dem Schreiben offen und
  // zeichnet dieselbe Tabelle mit der ANTWORT neu (zeichneTabelle in
  // public/js/18-wanted-xml.js). Wer dort hinsieht, sieht also sehr wohl
  // etwas — und seit es diese Regel gab, sah er leere Zellen. GEMESSEN:
  //
  //     VORSCHAU   : {"name":"Brick 2 x 4","bild":"https://…/3001-rot.png"}
  //     NACH IMPORT: {}
  //
  // Nicht nur das Bild fehlte, auch der Name; auf Marcos Bildschirmfoto ist
  // die Spalte NAME über alle 24 Zeilen leer.
  //
  // ── Warum NACH der Schleife und nicht davor ──────────────────────────────
  //
  // Davor wären die eben angelegten Teile noch nicht im Katalog: merkeTeil()
  // und merkeTeilFarbe() schreiben Name und Bild erst beim Anlegen (über
  // addManualPart). Ein Aufruf vorher zeigte für genau die Posten nichts, um
  // die es beim Import geht. Hier stehen sie drin.
  //
  // Die drei Abfragen sind drei für die GANZE Liste, nicht drei je Posten —
  // darauf ist beschreibePosten gebaut, und test/wanted-liste-vorschau-db
  // prüft es eigens („macht nicht eine Abfrage je Posten").
  //
  // Bei einem Abbruch trägt `bericht.posten` weniger Zeilen als `auf`; die
  // Zuordnung über den Index gilt trotzdem, weil die Schleife von vorne
  // zählt und nur früher aufhört.
  const beschreibung = await beschreibePosten(auf);
  bericht.posten.forEach((zeile, i) => {
    const b = beschreibung.get(i);
    if (!b) return;
    zeile.name = b.name;
    zeile.bild = b.bild;
    zeile.nameGeraten = b.geraten;
  });

  return bericht;
}
