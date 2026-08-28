/**
 * pgweb ist optional, nur lokal erreichbar und startet nicht von selbst mit.
 *
 * ── Warum es diesen Test gibt (Nachtrag 54) ─────────────────────────────────
 * pgweb bringt KEINE Anmeldung mit. Wer die Seite erreicht, hat vollen Zugriff
 * auf die Datenbank — alle Konten, alle Sitzungen, alle Daten — und kann sie
 * ändern. Der Dienst ist damit die einzige Stelle im ganzen Aufbau, an der eine
 * einzige geänderte Zeile in compose.yaml die komplette Installation offenlegt:
 * Aus `127.0.0.1:8081:8081` wird beim Kopieren schnell `8081:8081`, und dann
 * hängt die Datenbank je nach Router am offenen Netz.
 *
 * Genau diese drei Eigenschaften hält der Test fest:
 *   1. Bindung an 127.0.0.1 — nur auf dem Server selbst erreichbar
 *   2. profiles: ["tools"] — `docker compose up -d` startet ihn NICHT mit
 *   3. kein Volume aus dem Projekt — pgweb braucht keinen Dateizugriff
 *
 * Der Test prüft die tatsächliche YAML-Struktur, nicht den Wortlaut: Eine
 * Prüfung auf Zeichenketten wäre hier zu leicht auszuhebeln (ein Kommentar mit
 * der richtigen Zeichenfolge genügte).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Minimaler YAML-Leser für genau diese Datei.
 *
 * Bewusst kein Paket dafür: js-yaml wäre eine neue Abhängigkeit für eine
 * einzige Prüfung. Gebraucht wird nur, was unter `services:` an
 * Diensten steht und welche Werte deren Schlüssel tragen.
 */
function leseDienst(yaml, name) {
  const zeilen = yaml.split('\n');
  const start = zeilen.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  if (start < 0) return null;
  const block = [];
  for (let i = start + 1; i < zeilen.length; i++) {
    const l = zeilen[i];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue;
    if (/^  \S/.test(l) || /^\S/.test(l)) break;   // nächster Dienst / nächster Abschnitt
    block.push(l);
  }
  return block.join('\n');
}

const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

test('pgweb ist im compose-File vorhanden', () => {
  assert.ok(leseDienst(compose, 'pgweb'), 'der Dienst pgweb fehlt');
});

test('pgweb hört NUR auf 127.0.0.1', () => {
  const block = leseDienst(compose, 'pgweb');
  const ports = [...block.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map(m => m[1])
    .filter(p => /:\d+$/.test(p) && p.includes(':'));
  assert.ok(ports.length > 0, 'pgweb veröffentlicht keinen Port — dann ist er nicht erreichbar');
  for (const p of ports) {
    assert.ok(p.startsWith('127.0.0.1:'),
      `Portangabe "${p}" bindet an ALLE Schnittstellen. pgweb hat keine Anmeldung — ` +
      'damit stünde die ganze Datenbank offen. Zugriff von aussen gehört durch einen ' +
      'SSH-Tunnel, nicht durch eine offene Bindung');
  }
});

test('pgweb startet nicht bei `docker compose up`', () => {
  const block = leseDienst(compose, 'pgweb');
  assert.match(block, /profiles:\s*\[\s*"tools"\s*\]/,
    'ohne Profil liefe das Werkzeug dauerhaft mit — es soll nur auf Anforderung starten');
  // Gegenprobe im selben Test: Datenbank und App dürfen KEIN Profil haben,
  // sonst startet der normale Aufruf gar nichts mehr.
  for (const dienst of ['postgres', 'app']) {
    assert.doesNotMatch(leseDienst(compose, dienst), /profiles:/,
      `${dienst} darf kein Profil tragen — sonst startet "docker compose up -d" ihn nicht`);
  }
});

test('pgweb bekommt keinen Zugriff auf Projektdateien', () => {
  const block = leseDienst(compose, 'pgweb');
  assert.doesNotMatch(block, /^\s*volumes:/m,
    'pgweb braucht kein Volume — es spricht über das Netzwerk mit Postgres');
});
