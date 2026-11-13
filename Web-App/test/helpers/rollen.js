'use strict';
/**
 * Die Rollen eines Testlaufs wie im Betrieb (postgres/app-rolle.sh): Eigentümerin
 * (Migrationen, Testdaten), Laufzeitrolle (App), Systemrolle (BYPASSRLS). Ein
 * Superuser umginge den Zeilenschutz; ein fehlender Systemrahmen bliebe unsichtbar.
 * Die Namen hängen an der Vorlage, damit parallele Läufe auf einem Server sich nicht treffen.
 */

/** @param {string} vorlage */
function rollen(vorlage) {
  /** @param {string} art */
  const r = art => ({ name: `${vorlage}_rolle_${art}`, passwort: `test-${vorlage}-${art}` });
  return { eigen: r('eigen'), app: r('app'), system: r('system'), lesen: r('lesen') };
}

/** Dieselbe Adresse mit anderer Rolle. @param {string} url @param {{ name: string, passwort: string }} rolle */
function alsRolle(url, rolle) {
  const u = new URL(url);
  u.username = encodeURIComponent(rolle.name);
  u.password = encodeURIComponent(rolle.passwort);
  return u.toString();
}

/** Läuft die Datei noch als Superuser? Die Marke steht im Kopf der Testdatei
 * (Ratsche in test/rollen-trennung-db.test.js). @param {string} quelle */
const alsSuperuser = quelle => /^\s*(\*|\/\/)\s*@superuser\b/m.test(quelle);
/** Ruft die Datei Dienste im Systemrahmen auf (helpers/systemrahmen.js)? @param {string} quelle */
const imSystemrahmen = quelle => /^require\('\.\/helpers\/systemrahmen'\);/m.test(quelle);

module.exports = { rollen, alsRolle, alsSuperuser, imSystemrahmen };
