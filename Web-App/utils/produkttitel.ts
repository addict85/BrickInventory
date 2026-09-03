/**
 * Setnummer aus einem PRODUKTTITEL lesen (UPCitemdb).
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Hier stand:
 *
 *     const m = (item.title||'').match(/(?:#\s*)?(\d{4,6})/i);
 *     resolve(m ? { set_number: `${m[1]}-1`, name: item.title } : null);
 *
 * Also: die ERSTE 4- bis 6-stellige Zahl im Titel, egal welche. Titel kommen
 * von Händlern und sind Fliesstext:
 *
 *     „LEGO City 2023 Feuerwehrstation 60320"          → 2023
 *     „LEGO Star Wars Millennium Falcon 7541 Teile"    → 7541
 *     „LEGO Technic 42115 Lamborghini Sián 3696 Pcs"   → 42115  (zufällig richtig)
 *
 * In zwei von drei Fällen gewinnt die falsche Zahl, und die Antwort ging als
 * gültige Setnummer an die App.
 *
 * ── Die Regeln, und warum genau diese ───────────────────────────────────────
 *
 * Es wird NICHT versucht, die richtige Zahl sicher zu erraten — das geht aus
 * einem Fliesstext nicht. Es werden nur die ausgeschlossen, die nachweislich
 * etwas anderes sind, und der Rest wird geordnet zurückgegeben. Der Aufrufer
 * prüft die Kandidaten dann gegen den Katalog; erst dieser Abgleich entscheidet.
 *
 *  1. Eine Zahl, auf die ein MENGENWORT folgt, ist eine Teilezahl.
 *     („3696 Pcs", „7541 Teile", „1215 pieces")
 *  2. Eine Zahl mit vier Stellen zwischen 1949 und dem nächsten Jahr ist ein
 *     Jahr — ABER nur, wenn es noch andere Kandidaten gibt. LEGO-Sets mit
 *     vierstelliger Nummer in diesem Bereich gibt es wirklich (z. B. 1978er
 *     Serien), und lieber ein unsicherer Kandidat als gar keiner.
 *     1949 ist das Gründungsjahr der Steine; früher datierte Zahlen sind keine
 *     Jahresangaben in einem LEGO-Titel.
 *  3. Eine Zahl direkt hinter `#` ist bevorzugt — so schreiben Händler die
 *     Artikelnummer aus.
 *
 * Die Reihenfolge ist die Rückgabe: Der Aufrufer nimmt den ersten Kandidaten,
 * den der Katalog kennt.
 */

/** Wörter, die eine Zahl als Mengenangabe ausweisen. */
const MENGENWORT = /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teile?|stücke?|stueck|steine?|bricks?|parts?|elements?)\b/i;

/**
 * @param titel Produkttitel, wie ihn eine Händlerdatenbank liefert
 * @returns Kandidaten in absteigender Güte; leer, wenn nichts übrig bleibt
 */
function setnummerKandidaten(titel: string): string[] {
  if (!titel) return [];
  const jahrGrenze = new Date().getFullYear() + 1;

  type Kandidat = { wert: string; mitRaute: boolean; jahr: boolean };
  const gefunden: Kandidat[] = [];

  // \d{4,7}: Setnummern haben vier bis sieben Stellen. Die alte Fassung ging
  // nur bis sechs und hätte die siebenstelligen (Bestellnummern grosser Sets)
  // gar nicht erst gesehen.
  const muster = /(#\s*)?\b(\d{4,7})\b/g;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(titel)) !== null) {
    // treffer[2] ist durch das Muster garantiert, TypeScript weiss das unter
    // noUncheckedIndexedAccess nicht — deshalb der ausdrückliche Ausstieg.
    const wert = treffer[2];
    if (!wert) continue;
    const danach = titel.slice(treffer.index + treffer[0].length);
    if (MENGENWORT.test(danach)) continue;           // Regel 1: Teilezahl
    const zahl = parseInt(wert, 10);
    const jahr = wert.length === 4 && zahl >= 1949 && zahl <= jahrGrenze;
    gefunden.push({ wert, mitRaute: !!treffer[1], jahr });
  }

  const eindeutig = gefunden.filter((k, i) =>
    gefunden.findIndex(a => a.wert === k.wert) === i);

  // Regel 2: Jahre nur weglassen, solange etwas anderes bleibt.
  const ohneJahr = eindeutig.filter(k => !k.jahr);
  const uebrig = ohneJahr.length > 0 ? ohneJahr : eindeutig;

  // Regel 3: `#` zuerst, sonst in der Reihenfolge des Titels.
  return uebrig
    .slice()
    .sort((a, b) => Number(b.mitRaute) - Number(a.mitRaute))
    .map(k => k.wert);
}

export { setnummerKandidaten };
