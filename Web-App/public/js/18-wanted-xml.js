// ═══ BrickLink-Wanted-Listen: Vorschau, Import, Export ══════════════════════
//
// ── Marcos Vorgaben vom 19.10. ──────────────────────────────────────────────
//
//   „noch besser wäre wenn es beim Import die zu importierende Liste
//    vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
//    Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
//    rebrickable ids ergänzen könnte"
//
//   „Bitte auch den Import der xml Files für wanted listen in den Sets,
//    teilen und Minifiguren ergänzen und aus den Einstellungen entfernen."
//
//   „oder aus den Teileliste direkt die Teile in eine existierende oder neue
//    wanted list exportiert werden können"
//
// ── Warum eigene Datei ──────────────────────────────────────────────────────
//
// Der Import lag in 05-settings.js, weil der Knopf dort stand. Jetzt steht er
// in DREI Reitern, und der Dialog gehört in keinen von ihnen — er gehört zu
// der Sache, um die es geht. Der Export kommt dazu, und beide teilen das
// Format und die halbe Begründung.
//
// ── Warum der Export keine API benutzt ──────────────────────────────────────
//
// Weil es keine gibt. Die BrickLink-Store-API hat keine Wanted-Listen; die
// ganze Prüfung samt Quellen steht im Kopf von utils/wantedListeSchreiben.ts.
// Der dokumentierte Weg ist BrickLinks Massen-Upload, und der nimmt die Datei,
// die hier herauskommt.
import { registerActions } from './00-registry.js';
import { t, tRaw, colorName } from '../i18n.js';
import { G, api, esc, escHex, escUrl, fullUrl, hexZiffern, imgUrl, toast } from './01-core.js';
import { loadBrickColors, loadManualParts, loadManualFigsTable } from './06-minifigs.js';
import { loadGallery } from './02-gallery.js';
import { teileFilterJetzt } from './03-parts.js';

/**
 * Die gewählte Datei bleibt im Speicher, bis importiert oder geschlossen wird.
 *
 * Sie MUSS bleiben: Der Import ist zweistufig, und der zweite Schritt schickt
 * dieselbe Datei erneut — mit `schreiben=1` und den Korrekturen. Den Server
 * die Datei zwischenspeichern zu lassen wäre die Alternative; das hiesse,
 * fremde Dateien auf dem Server zu halten, bis irgendwann jemand bestätigt
 * oder eben nie.
 */
let _datei = null;
/** 'part' | 'fig' | 'set' — woher der Knopf kam. Steuert nur, was danach neu lädt. */
let _art = 'part';
/** index → { rbId?, rbFarbe? } — was in der Tabelle geändert wurde. */
let _korrekturen = new Map();
/** Der letzte Bericht, für die Tabelle. */
let _bericht = null;

// ── IMPORT ─────────────────────────────────────────────────────────────────

/** Datei gewählt (in einem der drei Reiter) → Vorschau holen. */
async function wantedXmlGewaehlt() {
  const el = this instanceof HTMLElement ? this : null;
  if (!el?.files?.[0]) return;
  _datei = el.files[0];
  _art = el.dataset.art || 'part';
  // Das Feld leeren: Sonst löst die GLEICHE Datei beim zweiten Mal kein
  // change-Ereignis aus, und der Dialog ginge nicht wieder auf.
  el.value = '';
  _korrekturen = new Map();
  G('wanted-xml-modal').classList.add('open');
  await lies(false);
}

function wantedXmlSchliessen() {
  G('wanted-xml-modal').classList.remove('open');
  _datei = null; _bericht = null; _korrekturen = new Map();
}

/** Nochmal lesen — z. B. nachdem „über Rebrickable nachfragen" gesetzt wurde. */
async function wantedXmlNeuLesen() { await lies(false); }

/** Jetzt wirklich schreiben. */
async function wantedXmlSchreiben() { await lies(true); }

/**
 * Der eine Weg zum Server, für beide Schritte.
 *
 * Zwei getrennte Wege hätten auseinanderlaufen können — und dann verspräche
 * die Vorschau etwas, das der Import nicht tut. Dieselbe Begründung steht
 * serverseitig an importiereWantedListe().
 */
async function lies(schreiben) {
  if (!_datei) return;
  const tab = G('wanted-xml-tabelle');
  const ber = G('wanted-xml-bericht');
  if (ber) ber.textContent = tRaw('import.running');
  if (!schreiben && tab) tab.innerHTML = '';

  const fd = new FormData();
  fd.append('file', _datei);
  if (schreiben && _korrekturen.size) {
    // Der Index reist MIT: Eine Liste darf denselben Posten zweimal
    // enthalten, und ein Schlüssel aus Nummer und Farbe träfe dann beide.
    // Art und Nummer sind die Gegenprobe des Servers.
    fd.append('korrekturen', JSON.stringify([..._korrekturen.entries()].map(([index, k]) => ({
      index: Number(index),
      blId: _bericht?.posten?.[index]?.blId ?? '',
      art:  _bericht?.posten?.[index]?.art  ?? 'part',
      ...k,
    }))));
  }
  const p = new URLSearchParams();
  if (schreiben) p.set('schreiben', '1');
  if (G('wanted-rb')?.checked) p.set('rebrickable', '1');

  let d;
  try {
    const r = await fetch(`/api/v1/wanted-list/import/xml?${p}`, { method: 'POST', body: fd });
    d = await r.json().catch(() => ({}));
  } catch { d = {}; }
  if (!d?.success) {
    if (ber) ber.textContent = '';
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  _bericht = d;
  zeichneBericht(d);
  zeichneTabelle(d);
  if (schreiben) {
    toast(tRaw('import.summary', { added: d.angelegt, updated: d.aufgestockt, errors: d.fehler }),
      d.fehler ? 'info' : 'success');
    // Was neu geladen wird, hängt daran, WAS die Liste enthielt — und das
    // weiss der Bericht besser als der Knopf, aus dem sie kam: Eine
    // Wanted-Liste darf Teile, Figuren UND Sets gemischt enthalten.
    const arten = new Set((d.posten || []).map(x => x.art));
    if (arten.has('part')) loadManualParts().catch(() => {});
    if (arten.has('fig'))  loadManualFigsTable().catch(() => {});
    if (arten.has('set'))  loadGallery().catch(() => {});
    _datei = null;
    _korrekturen = new Map();
  }
}

/** Die Zusammenfassung über der Tabelle. */
function zeichneBericht(d) {
  const el = G('wanted-xml-bericht');
  if (!el) return;
  // Die Stufen EINZELN und mit Worten statt Farben: Marco sieht Rot und Grün
  // schlecht, und „wahrscheinlich" ist eine Aussage, die dastehen muss und
  // nicht angedeutet werden darf.
  const stufe = (k, text) => (d.stufen?.[k]
    ? `<div>• ${esc(text)}: <strong>${d.stufen[k]}</strong></div>` : '');
  G('wanted-xml-sub').textContent = _datei?.name || '';
  const schreibKnopf = G('wanted-xml-schreiben');
  if (schreibKnopf) schreibKnopf.disabled = !d.vorschau;
  el.innerHTML = `
    <div style="border:1px solid var(--bdr);border-radius:8px;padding:.6rem">
      <div><strong>${d.gelesen}</strong> ${esc(tRaw('settings.wanted_read'))}${
        d.vorschau ? ` — ${esc(tRaw('settings.wanted_preview_only'))}` : ''}</div>
      ${stufe('zuordnung', tRaw('settings.wanted_s1'))}
      ${stufe('gleich_vermerkt', tRaw('settings.wanted_s2'))}
      ${stufe('katalogtreffer', tRaw('settings.wanted_s3'))}
      ${stufe('rebrickable', tRaw('settings.wanted_s4'))}
      ${stufe('korrigiert', tRaw('wanted.s_corrected'))}
      ${d.offen?.length ? `<div>⚠ <strong>${d.offen.length}</strong> ${
        esc(tRaw('settings.wanted_open'))}</div>` : ''}
      ${d.farbeOffen ? `<div>⚠ <strong>${d.farbeOffen}</strong> ${
        esc(tRaw('settings.wanted_color_open'))}</div>` : ''}
      ${Object.keys(d.fremdeArten || {}).length ? `<div>⚠ ${
        esc(tRaw('settings.wanted_other_kinds'))}: ${
        esc(Object.entries(d.fremdeArten).map(([k, n]) => `${k}=${n}`).join(', '))}</div>` : ''}
      ${d.rebrickable ? `<div>${esc(tRaw('settings.wanted_rb_asked'))}: ${
        d.rebrickable.gefragt} → ${d.rebrickable.gefunden}</div>` : ''}
      ${d.korrekturen?.abgewiesen?.length ? `<div>⚠ <strong>${
        d.korrekturen.abgewiesen.length}</strong> ${
        esc(tRaw('wanted.corrections_rejected'))}</div>` : ''}
      ${!d.vorschau ? `<div style="margin-top:.4rem"><strong>${d.angelegt}</strong> ${
        esc(tRaw('settings.wanted_written'))}${d.aufgestockt ? `, ${d.aufgestockt} ${
        esc(tRaw('wanted.topped_up'))}` : ''}${d.fehler ? `, ${d.fehler} ${
        esc(tRaw('settings.wanted_errors'))}` : ''}</div>` : ''}
    </div>`;
}

/** Was in einer Zeile steht. Siehe die Begründung an PostenErgebnis. */
function zeile(p, i) {
  const bild = p.bild
    ? `<img src="${escUrl(imgUrl(fullUrl(p.bild), true))}" alt="" loading="lazy"
         style="width:40px;height:40px;object-fit:contain;background:var(--s50);border-radius:4px" />`
    : '<div style="width:40px;height:40px;background:var(--s50);border-radius:4px"></div>';
  const punkt = p.farbHex
    ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${
        escHex(p.farbHex, 'var(--s300)')};border:1px solid rgba(0,0,0,.15);margin-right:4px"></span>`
    : '';
  // Der Ausgang mit WORTEN. „offen" ist die Aussage, auf die es ankommt — sie
  // darf nicht nur eine Farbe sein.
  const ausgang = esc(tRaw(`wanted.out_${p.ausgang}`) || p.ausgang);
  // Der Grund in der Sprache des Betrachters. `grund` vom Server ist ein
  // deutscher Satz — richtig fürs Protokoll, falsch in einer englischen
  // Tabelle (genau so am laufenden Server gesehen). Fehlt die Kennung (beim
  // Ausgang 'fehler' steht dort die Meldung der Ausnahme), bleibt der Satz.
  const grund = p.grundCode
    ? t(`wanted.grund_${p.grundCode}`, { farbe: p.blFarbe })
    : (p.grund ? esc(p.grund) : '');
  const korr = _korrekturen.get(i) || {};
  return `<tr${p.ausgang === 'offen' ? ' style="background:var(--s50)"' : ''}>
    <td>${bild}</td>
    <td style="font-family:monospace;font-size:.78rem">${esc(p.blId)}${
      p.rbId && p.rbId !== p.blId ? `<div style="color:var(--mut)">→ ${esc(p.rbId)}</div>` : ''}</td>
    <td style="font-size:.8rem">${esc(p.name || '')}${
      p.nameGeraten ? `<div style="color:var(--mut);font-size:.72rem">${
        esc(tRaw('wanted.name_guessed'))}</div>` : ''}</td>
    <td style="font-size:.8rem;white-space:nowrap">${punkt}${esc(p.farbName || '')}${
      p.blFarbe !== null && !p.farbName
        ? `<span style="color:var(--mut)">BL ${p.blFarbe}</span>` : ''}</td>
    <td style="text-align:right;font-size:.8rem">${p.menge}</td>
    <td style="font-size:.78rem">${ausgang}${
      grund ? `<div style="color:var(--mut);font-size:.72rem">${grund}</div>` : ''}</td>
    <td><input type="text" value="${esc(korr.rbId ?? '')}" placeholder="${
      esc(tRaw('wanted.rb_id_ph'))}" style="width:104px;font-size:.78rem;padding:2px 4px;
      border:1px solid var(--bdr);border-radius:5px"
      data-change="wantedKorrekturNummer" data-i="${i}" /></td>
    <td><select data-change="wantedKorrekturFarbe" data-i="${i}"
      style="max-width:140px;font-size:.78rem;padding:2px;border:1px solid var(--bdr);border-radius:5px">
      <option value="">${esc(tRaw('wanted.keep'))}</option></select></td>
  </tr>`;
}

function zeichneTabelle(d) {
  const el = G('wanted-xml-tabelle');
  if (!el) return;
  const posten = d.posten || [];
  if (!posten.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<table class="dt" style="font-size:.8rem"><thead><tr>
      <th>${t('col.image_th')}</th>
      <th>BrickLink</th>
      <th>${t('col.name')}</th>
      <th>${t('col.color')}</th>
      <th>${t('detail.qty')}</th>
      <th>${t('wanted.col_outcome')}</th>
      <th>${t('wanted.col_rb_id')}</th>
      <th>${t('wanted.col_set_color')}</th>
    </tr></thead><tbody>${posten.map(zeile).join('')}</tbody></table>`;
  fuelleFarbwahlen().catch(() => {});
}

/**
 * Die Farbauswahlen füllen — NACH dem Zeichnen.
 *
 * /v1/parts/brick-colors geht beim ersten Mal übers Netz; die Tabelle soll
 * nicht darauf warten. Bis dahin steht in jeder Auswahl „unverändert", und
 * genau das ist die Vorgabe.
 */
async function fuelleFarbwahlen() {
  const farben = await loadBrickColors();
  if (!farben?.length) return;
  const opts = farben.map(c =>
    `<option value="${c.id}" data-hex="${hexZiffern(c.hex)}">${esc(colorName(c.name))}</option>`).join('');
  for (const sel of G('wanted-xml-tabelle').querySelectorAll('select[data-change="wantedKorrekturFarbe"]')) {
    const i = Number(sel.dataset.i);
    const gewaehlt = _korrekturen.get(i)?.rbFarbe;
    sel.innerHTML = `<option value="">${esc(tRaw('wanted.keep'))}</option>${opts}`;
    if (gewaehlt !== undefined && gewaehlt !== null) sel.value = String(gewaehlt);
  }
}

/** Eine eingetragene Rebrickable-Nummer merken (oder die Eintragung löschen). */
function wantedKorrekturNummer() {
  const el = this instanceof HTMLElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const wert = el.value.trim();
  const k = { ..._korrekturen.get(i) };
  // Leeres Feld heisst „nichts eintragen", nicht „Nummer löschen": Der Server
  // unterscheidet `undefined` (nicht angefasst) von `null` (ausdrücklich
  // geleert), und hier ist das erste gemeint.
  if (wert === '') delete k.rbId; else k.rbId = wert;
  setzeKorrektur(i, k);
}

function wantedKorrekturFarbe() {
  const el = this instanceof HTMLElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const k = { ..._korrekturen.get(i) };
  if (el.value === '') delete k.rbFarbe; else k.rbFarbe = parseInt(el.value, 10);
  setzeKorrektur(i, k);
}

function setzeKorrektur(i, k) {
  if (Object.keys(k).length === 0) _korrekturen.delete(i);
  else _korrekturen.set(i, k);
  const knopf = G('wanted-xml-schreiben');
  if (knopf) {
    // Die Zahl am Knopf, damit sichtbar ist, dass die Korrekturen mitgehen —
    // sonst bleibt es ein Versprechen, das man erst nachher prüfen kann.
    knopf.textContent = _korrekturen.size
      ? `${tRaw('settings.wanted_write')} (${_korrekturen.size})`
      : tRaw('settings.wanted_write');
  }
}

// ── EXPORT ─────────────────────────────────────────────────────────────────

function wantedExportOeffnen() {
  const el = this instanceof HTMLElement ? this : null;
  _art = el?.dataset?.art || 'part';
  G('wanted-export-bericht').innerHTML = '';
  G('wanted-export-modal').classList.add('open');
}

function wantedExportSchliessen() { G('wanted-export-modal').classList.remove('open'); }

async function wantedExportBauen() {
  const el = G('wanted-export-bericht');
  el.textContent = tRaw('import.running');
  const d = await api('POST', '/v1/wanted-list/export/xml', {
    art: _art,
    wanted_list_id: G('wanted-export-id')?.value.trim() || '',
    mit_lagerort: !!G('wanted-export-lagerort')?.checked,
    // Derselbe Filter, den die Liste gerade benutzt — Marco exportiert, was er
    // vor sich sieht. Die Herleitung steht an teileFilterJetzt().
    filter: _art === 'part' ? teileFilterJetzt() : {},
  }).catch(() => null);
  if (!d?.success) {
    el.textContent = '';
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  const stuecke = d.stuecke || [];
  el.innerHTML = `
    <div><strong>${d.enthalten}</strong> ${esc(tRaw('wanted.export_included'))}${
      stuecke.length > 1 ? ` — ${stuecke.length} ${esc(tRaw('wanted.export_parts'))}` : ''}</div>
    ${d.ohne_farbe?.length ? `<div style="margin-top:.4rem">⚠ <strong>${
      d.ohne_farbe.length}</strong> ${esc(tRaw('wanted.export_no_color'))}:
      <div style="color:var(--mut);font-size:.76rem;max-height:7rem;overflow:auto">${
        d.ohne_farbe.map(o => esc(`${o.blId} (${o.farbName || o.farbe})`)).join(', ')}</div></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:.6rem">${
      stuecke.map((_, i) => `<button class="btn bs btn-sm" type="button"
        data-click="wantedExportLaden" data-i="${i}">⬇ ${
        esc(tRaw('wanted.export_download'))}${stuecke.length > 1 ? ` ${i + 1}/${stuecke.length}` : ''}
      </button>`).join('')}</div>`;
  _stuecke = stuecke;
}

/** Die erzeugten Dateien, bis der Dialog zugeht. */
let _stuecke = [];

/**
 * Ein Stück als Datei herunterladen.
 *
 * Über einen Blob und nicht über eine Adresse am Server: Die Datei ist schon
 * da (sie kam mit der Antwort), und ein zweiter Weg dafür hiesse, sie auf dem
 * Server zu halten oder ein zweites Mal zu bauen.
 */
function wantedExportLaden() {
  const el = this instanceof HTMLElement ? this : null;
  const i = Number(el?.dataset?.i ?? 0);
  const xml = _stuecke[i];
  if (!xml) return;
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  a.href = url;
  a.download = _stuecke.length > 1
    ? `wanted-${_art}-${i + 1}.xml` : `wanted-${_art}.xml`;
  a.click();
  // Die Adresse freigeben — sonst bleibt der Inhalt bis zum Neuladen der
  // Seite im Speicher, und bei 200 KB je Stück summiert sich das.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

G('wanted-xml-modal')?.addEventListener('click',
  e => e.target.id === 'wanted-xml-modal' && wantedXmlSchliessen());
G('wanted-export-modal')?.addEventListener('click',
  e => e.target.id === 'wanted-export-modal' && wantedExportSchliessen());

registerActions({
  wantedExportBauen,
  wantedExportLaden,
  wantedExportOeffnen,
  wantedExportSchliessen,
  wantedKorrekturFarbe,
  wantedKorrekturNummer,
  wantedXmlGewaehlt,
  wantedXmlNeuLesen,
  wantedXmlSchliessen,
  wantedXmlSchreiben,
});
