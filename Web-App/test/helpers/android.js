/**
 * Android-Quellen über alle Gradle-Module.
 */
const fs = require('node:fs');
const path = require('node:path');

const ANDROID = path.join(__dirname, '..', '..', '..', 'Android-App');
const PAKET = path.join('java', 'ch', 'brickinventoryapp');

/** Die Gradle-Module (Ordner mit build.gradle.kts). @returns {string[]} */
function gradleModule() {
  return fs.readdirSync(ANDROID)
    .filter((d) => fs.existsSync(path.join(ANDROID, d, 'build.gradle.kts')))
    .sort();
}

/**
 * Die Wurzeln ch/brickinventoryapp der Haupt- (oder Test-)Quellen aller Module.
 * @param {string} [art]
 * @returns {string[]}
 */
function quellwurzeln(art = 'main') {
  return gradleModule().map((m) => path.join(ANDROID, m, 'src', art, PAKET)).filter((p) => fs.existsSync(p));
}

/**
 * Pfad einer Kotlin-Datei relativ zu ch/brickinventoryapp, in welchem Modul auch immer.
 * @param {string} rel
 * @param {string} [art]
 * @returns {string}
 */
function androidDatei(rel, art = 'main') {
  const treffer = quellwurzeln(art).map((w) => path.join(w, rel)).filter((p) => fs.existsSync(p));
  const [eine] = treffer;
  if (treffer.length !== 1 || eine === undefined) {
    throw new Error(`${rel}: ${treffer.length} Fundstellen in den Android-Modulen (erwartet: genau eine)`);
  }
  return eine;
}

/**
 * Eine Ressourcendatei relativ zu src/main/res (Texte liegen in core-ressourcen).
 * @param {string} rel
 * @returns {string}
 */
function androidRes(rel) {
  const treffer = gradleModule().map((m) => path.join(ANDROID, m, 'src', 'main', 'res', rel)).filter((p) => fs.existsSync(p));
  const [eine] = treffer;
  if (treffer.length !== 1 || eine === undefined) throw new Error(`res/${rel}: ${treffer.length} Fundstellen (erwartet: genau eine)`);
  return eine;
}

/**
 * Alle Dateien unter den Hauptquellen aller Module, die `filter` annimmt.
 * @param {(pfad: string) => boolean} [filter]
 * @param {string} [art]
 * @returns {string[]}
 */
function androidDateien(filter = (f) => f.endsWith('.kt'), art = 'main') {
  /** @type {string[]} */
  const aus = [];
  /** @param {string} d */
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
