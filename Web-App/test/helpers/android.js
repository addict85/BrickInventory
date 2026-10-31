/**
 * Android-Quellen über alle Gradle-Module.
 *
 * Seit der Aufteilung der App liegt eine Kotlin-Datei in app, einem core- oder
 * einem feature-Modul. Die Web-Tests fragen nach dem Paketpfad (`ui/screens/X.kt`),
 * nicht nach dem Modul: Wandert eine Datei zwischen Modulen, bleibt der Test
 * gleich. Was es nicht genau einmal gibt, ist ein Fehler mit Namen — nie eine
 * leere Zeichenkette, die eine Prüfung still bestehen liesse.
 */
const fs = require('node:fs');
const path = require('node:path');

const ANDROID = path.join(__dirname, '..', '..', '..', 'Android-App');
const PAKET = path.join('java', 'ch', 'brickinventoryapp');

/** Die Gradle-Module (Ordner mit build.gradle.kts). */
function gradleModule() {
  return fs.readdirSync(ANDROID)
    .filter((d) => fs.existsSync(path.join(ANDROID, d, 'build.gradle.kts')))
    .sort();
}

/** Die Wurzeln ch/brickinventoryapp der Haupt- (oder Test-)Quellen aller Module. */
function quellwurzeln(art = 'main') {
  return gradleModule().map((m) => path.join(ANDROID, m, 'src', art, PAKET)).filter((p) => fs.existsSync(p));
}

/** Pfad einer Kotlin-Datei relativ zu ch/brickinventoryapp, in welchem Modul auch immer. */
function androidDatei(rel, art = 'main') {
  const treffer = quellwurzeln(art).map((w) => path.join(w, rel)).filter((p) => fs.existsSync(p));
  if (treffer.length !== 1) {
    throw new Error(`${rel}: ${treffer.length} Fundstellen in den Android-Modulen (erwartet: genau eine)`);
  }
  return treffer[0];
}

/** Eine Ressourcendatei relativ zu src/main/res (Texte liegen in core-ressourcen). */
function androidRes(rel) {
  const treffer = gradleModule().map((m) => path.join(ANDROID, m, 'src', 'main', 'res', rel)).filter((p) => fs.existsSync(p));
  if (treffer.length !== 1) throw new Error(`res/${rel}: ${treffer.length} Fundstellen (erwartet: genau eine)`);
  return treffer[0];
}

/** Alle Dateien unter den Hauptquellen aller Module, die `filter` annimmt. */
function androidDateien(filter = (f) => f.endsWith('.kt'), art = 'main') {
  const aus = [];
  const gehen = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gehen(p);
      else if (filter(p)) aus.push(p);
    }
  };
  for (const m of gradleModule()) {
    const w = path.join(ANDROID, m, 'src', art);
    if (fs.existsSync(w)) gehen(w);
  }
  return aus;
}

module.exports = { ANDROID, gradleModule, quellwurzeln, androidDatei, androidRes, androidDateien };
