// Wanted-Listen von BrickLink: erst eine Vorschau wie die Teileliste, in der man korrigieren und
// Rebrickable-Nummern ergänzen kann, dann der Import — bei Sets, Teilen und Figuren, dort wo man die Posten
// danach sieht.
import { registerActions } from './registry.js';
import { t, tRaw, colorName } from '../i18n.js';
import { escHex, hexZiffern, esc, html, ungeprueft } from './escapen.js';
import { apiRoh } from './api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl } from './bilder.js';
import { ico, G, XML_ICON_SVG, setzeHtml } from './dom.js';
import { toast } from './meldungen.js';
import { loadManualFigsTable } from './minifigs.js';
import { loadGallery } from './gallery.js';
import { loadManualParts } from './parts.js';
import { loadBrickColors } from './teil-erfassen.js';

/**
 * Der Bericht des Servers (WantedXmlErgebnis). Die Felder je Posten, die die Tabelle zeigt, nennt der Vertrag
 * noch nicht; so schreibt sie src/merkliste.
 * @typedef {import('../../frontend-typen/vertrag').WantedXmlErgebnis['posten'][number] & {
 *   bild?: string | null, blFarbe?: number | null, farbHex?: string | null, farbName?: string | null,
 *   grund?: string | null, grundCode?: string | null, maxPreis?: number | null, name?: string | null,
 *   nameGeraten?: boolean, rbId?: string | null, set?: string | null, zustand?: string | null }} Posten
 * @typedef {import('../../frontend-typen/vertrag').WantedXmlErgebnis & { posten: Posten[],
 *   abgebrochen?: boolean, farbeOffen?: number, fremdeArten?: Record<string, number>,
 *   korrekturen?: { abgewiesen?: unknown[] },
 *   rebrickable?: { gefragt: number, gefunden: number, abgebrochen?: 'kontingent' | 'kein_schluessel' | 'stoerung' } | null,
 *   stufen?: Record<string, number>, standardZustand?: string | null }} Bericht
 */
/** Warum die Rebrickable-Stufe vorzeitig endete; die übrigen Posten blieben offen. */
const RB_ABBRUCH = /** @type {const} */ ({
  kontingent: 'wanted.rb_stopped_quota',
  kein_schluessel: 'wanted.rb_stopped_key',
  stoerung: 'wanted.rb_stopped_error',
});
/**
 * Die gewählte Datei bleibt bis zum Import im Speicher: Der zweite Schritt schickt sie mit den Korrekturen
 * erneut. Sonst müsste der Server fremde Dateien halten, bis jemand bestätigt — oder nie.
 * @type {File | null}
 */
let _datei = null;
/** index → { rbId?, rbFarbe? } — was in der Tabelle geändert wurde. */
/** @type {Map<number, Record<string, string | number | null>>} */
let _korrekturen = new Map();
/** Der letzte Bericht, für die Tabelle. @type {Bericht | null} */
let _bericht = null;
/**
 * Läuft gerade eine Anfrage? Ein zweiter Klick ist nicht harmlos: Der Schreibschritt addiert auf die
 * Erfassung desselben Tages, eine doppelte Anfrage verdoppelte also die Mengen.
 */
let _laeuft = false;

/**
 * Welche Knöpfe bedienbar sind, an einer Stelle aus _laeuft, _datei und _bericht abgeleitet: Zwei Zuweisungen
 * an denselben Knopf überschrieben sich gegenseitig, sobald das Freigeben nach dem Lauf kam.
 */
function knoepfeStand() {
  const schreiben = G('wanted-xml-schreiben');
  const neu = G('wanted-xml-neu');
  // Schreiben nur, wenn eine Vorschau dasteht: Nach dem Schreiben ist
  // `vorschau` false, und ein zweiter Klick wäre ein zweiter Import.
  if (schreiben) schreiben.disabled = _laeuft || !_bericht?.vorschau;
  // Neu einlesen braucht die Datei — nach dem Schreiben ist sie weg.
  if (neu) neu.disabled = _laeuft || !_datei;
}

// ── IMPORT ─────────────────────────────────────────────────────────────────

/** Datei gewählt (in einem der drei Reiter) → Vorschau holen. @this {unknown} */
async function wantedXmlGewaehlt() {
  const el = this instanceof HTMLInputElement ? this : null;
  if (!el?.files?.[0]) return;
  // Während ein Import läuft, keine neue Datei annehmen: Sie würde _datei mitten im laufenden Schreiben
  // austauschen. Der Knopf daneben lässt sich sperren, dieser hier ist ein <label> um ein verstecktes Feld —
  // er wird nicht grau, also wird die Eingabe hier abgewiesen.
  if (_laeuft) { toast(tRaw('import.running'), 'info'); el.value = ''; return; }
  _datei = el.files[0];
  // Das Feld leeren: Sonst löst die GLEICHE Datei beim zweiten Mal kein change-Ereignis aus, und der Dialog
  // ginge nicht wieder auf.
  el.value = '';
  _korrekturen = new Map();
  G('wanted-xml-modal').classList.add('open');
  await lies(false);
}

function wantedXmlSchliessen() {
  G('wanted-xml-modal').classList.remove('open');
  _datei = null; _bericht = null; _korrekturen = new Map();
  // Ohne Datei und ohne Bericht sind beide Knöpfe tot — beim nächsten Öffnen schaltet die Vorschau sie wieder
  // frei.
  knoepfeStand();
}

/** Nochmal lesen — z. B. nachdem „über Rebrickable nachfragen" gesetzt wurde. */
async function wantedXmlNeuLesen() { await lies(false); }

/** Jetzt wirklich schreiben. */
async function wantedXmlSchreiben() { await lies(true); }

/**
 * Der eine Weg zum Server, für beide Schritte.
 *
 * Zwei getrennte Wege hätten auseinanderlaufen können — und dann verspräche die Vorschau etwas, das der
 * Import nicht tut. Dieselbe Begründung steht serverseitig an importiereWantedListe().
 * @param {boolean} schreiben
 */
async function lies(schreiben) {
  if (!_datei || _laeuft) return;
  _laeuft = true;
  knoepfeStand();
  try {
    await liesWirklich(schreiben);
  } finally {
    // IMMER freigeben, auch wenn etwas geworfen hat: Ein Riegel, der nach einem Fehler liegen bleibt, macht
    // den Dialog unbrauchbar, bis man ihn schliesst — und sieht aus wie ein hängender Import.
    _laeuft = false;
    knoepfeStand();
  }
}

/**
 * Den Fortschrittsbalken setzen oder verstecken. Er unterscheidet zwei Phasen (Nachfragen bei Rebrickable,
 * Schreiben), mit einem Satz darunter — ein Balken ohne Beschriftung liesse offen, worauf man wartet.
 * @param {{phase:string,fertig:number,gesamt:number}|null} stand
 *   null blendet ihn aus (vor dem ersten Lauf, nach dem letzten).
 */
function zeichneFortschritt(stand) {
  const box = G('wanted-xml-fortschritt');
  if (!box) return;
  if (!stand || !stand.gesamt) { box.style.display = 'none'; return; }
  const anteil = Math.max(0, Math.min(100, Math.round(stand.fertig / stand.gesamt * 100)));
  box.style.display = '';
  const balken = G('wanted-xml-balken');
  if (balken) balken.style.width = anteil + '%';
  // Dieselbe Zahl auch für Screenreader: Ein Balken, der nur breiter wird, ist für sie gar keine Auskunft.
  G('wanted-xml-balken-wrap')?.setAttribute('aria-valuenow', String(anteil));
  const txt = G('wanted-xml-fortschritt-text');
  if (txt) {
    // tRaw und nicht t: Das Ziel ist textContent, und t() maskiert für HTML — die Maskierung stünde als
    // Zeichenfolge da (test/frontend-escaping.test.js).
    txt.textContent = tRaw(
      stand.phase === 'rebrickable' ? 'wanted.progress_rb' : 'wanted.progress_write',
      { done: stand.fertig, total: stand.gesamt });
  }
}

/**
 * Die Antwort zeilenweise lesen (NDJSON) und dabei den Balken füllen; der letzte Satz ist der Bericht. Ohne
 * response.body (fetch-Ersatz in den Prüfungen) liest der Rückfall alles als ein JSON.
 * @param {Response} r
 * @returns {Promise<Partial<Bericht> & { success?: boolean, error?: string }>} der Bericht (die letzte Zeile)
 */
async function liesStrom(r) {
  if (!r.body?.getReader) return await r.json().catch(() => ({}));
  const leser = r.body.getReader();
  const entpacker = new TextDecoder();
  let rest = '';
  let letzte = null;
  for (;;) {
    const { value, done } = await leser.read();
    if (done) break;
    rest += entpacker.decode(value, { stream: true });
    // Die letzte Zeile eines Stücks ist oft angeschnitten — sie bleibt in
    // `rest` liegen, bis ihr Zeilenumbruch kommt. Ohne das zerbricht ein
    // Bericht, der über zwei TCP-Pakete geht, mitten im JSON.
    const zeilen = rest.split('\n');
    rest = zeilen.pop() ?? '';
    for (const z of zeilen) {
      if (!z.trim()) continue;
      let o;
      try { o = JSON.parse(z); } catch { continue; }
      if (o.fortschritt) { zeichneFortschritt(o.fortschritt); continue; }
      letzte = o;
    }
  }
  if (rest.trim()) { try { letzte = JSON.parse(rest); } catch { /* unvollständig */ } }
  return letzte ?? {};
}

/**
 * Der eigentliche Lauf. Getrennt, damit der Riegel in lies() ein try/finally hat.
 * @param {boolean} schreiben
 */
async function liesWirklich(schreiben) {
  const tab = G('wanted-xml-tabelle');
  const ber = G('wanted-xml-bericht');
  if (ber) ber.textContent = tRaw('import.running');
  if (!schreiben && tab) tab.replaceChildren();

  const fd = new FormData();
  if (_datei) fd.append('file', _datei);
  if (schreiben && _korrekturen.size) {
    // Der Index reist MIT: Eine Liste darf denselben Posten zweimal enthalten, und ein Schlüssel aus Nummer
    // und Farbe träfe dann beide. Art und Nummer sind die Gegenprobe des Servers.
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
  // Der Fortschritt kostet nichts, wenn niemand hinsieht — aber hier sieht jemand hin, also immer.
  p.set('strom', '1');

  zeichneFortschritt(null);
  let d;
  try {
    const r = await apiRoh('POST', `/v1/wanted-list/import/xml?${p}`, { body: fd });
    d = await liesStrom(r);
  } catch { d = {}; }
  zeichneFortschritt(null);
  if (!d?.success) {
    if (ber) ber.textContent = '';
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // success heisst: Der Server hat den ganzen Bericht geschickt.
  const bericht = /** @type {Bericht} */ (d);
  _bericht = bericht;
  zeichneBericht(bericht);
  zeichneTabelle(bericht);
  if (schreiben) {
    toast(tRaw('import.summary', { added: d.angelegt, updated: d.aufgestockt, errors: d.fehler }),
      d.fehler ? 'info' : 'success');
    // Was neu geladen wird, hängt daran, WAS die Liste enthielt — und das weiss der Bericht besser als der
    // Knopf, aus dem sie kam: Eine Wanted-Liste darf Teile, Figuren UND Sets gemischt enthalten.
    const arten = new Set((d.posten || []).map(x => x.art));
    if (arten.has('part')) loadManualParts().catch(() => {});
    if (arten.has('fig'))  loadManualFigsTable().catch(() => {});
    if (arten.has('set'))  loadGallery().catch(() => {});
    _datei = null;
    _korrekturen = new Map();
  }
}

/** Die Zusammenfassung über der Tabelle. */
/** @param {Bericht} d */
function zeichneBericht(d) {
  const el = G('wanted-xml-bericht');
  if (!el) return;
  // Die Stufen EINZELN und mit Worten statt Farben: Marco sieht Rot und Grün schlecht, und „wahrscheinlich"
  // ist eine Aussage, die dastehen muss und nicht angedeutet werden darf.
  const stufe = (/** @type {string} */ k, /** @type {string} */ text) => (d.stufen?.[k]
    ? html`<div>• ${text}: <strong>${d.stufen[k]}</strong></div>` : '');
  G('wanted-xml-sub').textContent = _datei?.name || '';
  // Der Knopfzustand kommt aus knoepfeStand() — siehe die Begründung dort.
  knoepfeStand();
  setzeHtml(el, html`
    <div data-stil="border:1px solid var(--bdr);border-radius:8px;padding:.6rem">
      <div><strong>${d.gelesen}</strong> ${tRaw('settings.wanted_read')}${d.vorschau ? html` — ${tRaw('settings.wanted_preview_only')}` : ''}</div>
      ${stufe('zuordnung', tRaw('settings.wanted_s1'))}
      ${stufe('gleich_vermerkt', tRaw('settings.wanted_s2'))}
      ${stufe('katalogtreffer', tRaw('settings.wanted_s3'))}
      ${stufe('rebrickable', tRaw('settings.wanted_s4'))}
      ${stufe('korrigiert', tRaw('wanted.s_corrected'))}
      ${d.offen?.length ? html`<div>${ico('warnung')} <strong>${d.offen.length}</strong> ${tRaw('settings.wanted_open')}</div>` : ''}
      ${d.farbeOffen ? html`<div>${ico('warnung')} <strong>${d.farbeOffen}</strong> ${tRaw('settings.wanted_color_open')}</div>` : ''}
      ${Object.keys(d.fremdeArten || {}).length ? html`<div>${ico('warnung')} ${tRaw('settings.wanted_other_kinds')}: ${Object.entries(d.fremdeArten ?? {}).map(([k, n]) => `${k}=${n}`).join(', ')}</div>` : ''}
      ${d.rebrickable ? html`<div>${tRaw('settings.wanted_rb_asked')}: ${d.rebrickable.gefragt} → ${d.rebrickable.gefunden}</div>` : ''}
      ${d.rebrickable?.abgebrochen ? html`<div>${ico('warnung')} ${tRaw(RB_ABBRUCH[d.rebrickable.abgebrochen])}</div>` : ''}
      ${d.korrekturen?.abgewiesen?.length ? html`<div>${ico('warnung')} <strong>${d.korrekturen.abgewiesen.length}</strong> ${tRaw('wanted.corrections_rejected')}</div>` : ''}
      ${d.abgebrochen ? html`<div>${ico('warnung')} ${tRaw('wanted.cancelled')}</div>` : ''}
      ${!d.vorschau ? html`<div data-stil="margin-top:.4rem"><strong>${d.angelegt}</strong> ${tRaw('settings.wanted_written')}${d.aufgestockt ? html`, ${d.aufgestockt} ${tRaw('wanted.topped_up')}` : ''}${d.fehler ? html`, ${d.fehler} ${tRaw('settings.wanted_errors')}` : ''}</div>` : ''}
    </div>`);
}

/** Was in einer Zeile steht. Siehe die Begründung an PostenErgebnis. */
/** @param {Posten} p @param {number} i */
function zeile(p, i) {
  const bild = p.bild
    ? bildTag({ src: imgUrl(fullUrl(p.bild), true), alt: '', klasse: 'bild-40', ph: 'teil' })
    : html`<span class="bild-ph bild-40" aria-hidden="true">${platzhalterInhalt('teil')}</span>`;
  const punkt = p.farbHex
    ? html`<span data-stil="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.15);margin-right:4px"
        data-farbe="${escHex(p.farbHex, 'var(--s300)')}"></span>`
    : '';
  // Der Ausgang in Worten, nicht nur als Farbe. In der Vorschau „wird angelegt“, nach dem Import „angelegt“:
  // Sonst stand nach dem Schreiben in jeder Zeile noch die Zukunftsform.
  const kuenftig = !!_bericht?.vorschau;
  const ausgang = esc(tRaw(
    p.ausgang === 'angelegt' && !kuenftig ? 'wanted.out_angelegt_fertig'
                                          : `wanted.out_${p.ausgang}`) || p.ausgang);
  // Der Grund in der Sprache des Betrachters. `grund` vom Server ist ein deutscher Satz — richtig fürs
  // Protokoll, falsch in einer englischen Tabelle (genau so am laufenden Server gesehen). Fehlt die Kennung
  // (beim Ausgang 'fehler' steht dort die Meldung der Ausnahme), bleibt der Satz.
  const grund = p.grundCode
    ? t(`wanted.grund_${p.grundCode}`, { farbe: p.blFarbe })
    : (p.grund ? esc(p.grund) : '');
  // Der Zustand, der angelegt wird: aus der Datei, sonst der Standard des Kontos — mit dem Zusatz, dass er
  // von dort stammt. Ohne Zusatz läse sich „Gebraucht“ wie eine Angabe aus der Datei.
  const zustandWert = p.zustand === 'N' || p.zustand === 'U'
    ? p.zustand : (_bericht?.standardZustand || null);
  const ausStandard = p.zustand !== 'N' && p.zustand !== 'U';
  const zustandZelle = zustandWert
    ? html`<span class="cond-badge ${zustandWert === 'U' ? 'cond-used' : 'cond-new'}">${tRaw(zustandWert === 'U' ? 'common.condition_used' : 'common.condition_new')}</span>${ausStandard ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.cond_default')}</div>` : ''}`
    : '';
  const korr = _korrekturen.get(i) || {};

  // Die Werte aus der Datei, vorbefüllt und bearbeitbar. Hier ist jede Abweichung vom Ausgangswert eine
  // Korrektur — anders als bei den leeren Korrekturfeldern rechts, wo leer „nicht angefasst“ heisst.
  // Jedes Feld nennt Spalte und Posten: Ein Vorleser hörte sonst „Drehfeld 1“ ohne Bezug zur Zeile.
  const id = p.blId;
  const feld = (/** @type {string} */ name, /** @type {unknown} */ wert, extra = '', breit = 72, schluessel = 'wanted.feld_menge') =>
    html`<input data-change="wantedKorrekturWert" data-feld="${name}" data-i="${i}" aria-label="${tRaw(schluessel, { id })}"
       value="${wert}" ${ungeprueft(extra)}
       data-breite-px="${breit}"
       data-stil="font-size:var(--fs-1);padding:2px 4px;border:1px solid var(--feldrand);border-radius:5px;text-align:right" />`;
  const mengeZelle = feld('menge', korr.menge ?? p.menge, 'type="number" min="1" step="1"');
  // Der Preis je Stück. Leer heisst „keiner" — dann holt der Import den Marktpreis, wie bei MAXPRICE=-1 in
  // der Datei.
  const preisWert = korr.kaufpreis !== undefined ? (korr.kaufpreis ?? '') : (p.maxPreis ?? '');
  const preisZelle = feld('kaufpreis', preisWert,
    `type="number" min="0" step="0.0001" placeholder="${esc(tRaw('wanted.price_ph'))}"`, 96, 'wanted.feld_preis');
  // Der Zustand als Auswahl mit DREI Möglichkeiten: Der leere Wert ist keine Lücke, sondern „Standard des
  // Kontos" — dieselbe Aussage wie CONDITION=X.
  const zustandJetzt = korr.zustand !== undefined ? (korr.zustand ?? '') : (p.zustand ?? '');
  const wahl = (/** @type {string} */ w, /** @type {string} */ text) =>
    html`<option value="${w}"${zustandJetzt === w ? ' selected' : ''}>${text}</option>`;
  const zustandWahl = html`<select data-change="wantedKorrekturWert" data-feld="zustand" data-i="${i}" aria-label="${tRaw('wanted.feld_zustand', { id })}"
      data-stil="font-size:var(--fs-1);padding:2px;border:1px solid var(--feldrand);border-radius:5px">
      ${wahl('', tRaw('wanted.cond_default_opt'))}
      ${wahl('N', tRaw('common.condition_new'))}
      ${wahl('U', tRaw('common.condition_used'))}
    </select>`;

  return html`<tr${p.ausgang === 'offen' ? html` data-stil="background:var(--s50)"` : ''}>
    <td>${bild}</td>
    <td data-stil="font-family:monospace;font-size:var(--fs-1)">${p.blId}${p.rbId && p.rbId !== p.blId ? html`<div data-stil="color:var(--mut)">→ ${p.rbId}</div>` : ''}</td>
    <td data-stil="font-size:var(--fs-2)">${p.name || ''}${p.nameGeraten ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.name_guessed')}</div>` : ''}</td>
    <td data-stil="font-size:var(--fs-2);white-space:nowrap">${punkt}${p.farbName || ''}${p.blFarbe !== null && !p.farbName ? html`<span data-stil="color:var(--mut)">BL ${p.blFarbe}</span>` : ''}</td>
    <td data-stil="text-align:right">${mengeZelle}</td>
    <td data-stil="font-size:var(--fs-1);white-space:nowrap">${zustandWahl}${zustandJetzt === '' && zustandZelle ? html`<div data-stil="margin-top:2px">${zustandZelle}</div>` : ''}</td>
    <td data-stil="text-align:right">${preisZelle}</td>
    <td data-stil="font-size:var(--fs-1)">${ungeprueft(ausgang)}${grund ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${ungeprueft(grund)}</div>` : ''}</td>
    <td><input type="text" value="${korr.rbId ?? ''}" placeholder="${tRaw('wanted.rb_id_ph')}" aria-label="${tRaw('wanted.feld_rb', { id })}" data-stil="width:8em;max-width:100%;font-size:var(--fs-1);padding:2px 4px;
      border:1px solid var(--feldrand);border-radius:5px"
      data-change="wantedKorrekturNummer" data-i="${i}" /></td>
    <td><select data-change="wantedKorrekturFarbe" data-i="${i}" aria-label="${tRaw('wanted.feld_farbe', { id })}"
      data-stil="max-width:140px;font-size:var(--fs-1);padding:2px;border:1px solid var(--feldrand);border-radius:5px">
      <option value="">${tRaw('wanted.keep')}</option></select></td>
  </tr>`;
}

/** @param {Bericht} d */
function zeichneTabelle(d) {
  const el = G('wanted-xml-tabelle');
  if (!el) return;
  const posten = d.posten || [];
  if (!posten.length) { el.replaceChildren(); return; }
  setzeHtml(el, html`<table class="dt" aria-label="${tRaw('wanted.preview_title')}" data-stil="font-size:var(--fs-2)"><thead><tr>
      <th>${tRaw('col.image_th')}</th>
      <th>BrickLink</th>
      <th>${tRaw('col.name')}</th>
      <th>${tRaw('col.color')}</th>
      <th>${tRaw('detail.qty')}</th>
      <th>${tRaw('common.condition')}</th>
      <th>${tRaw('detail.purchase_price')}</th>
      <th>${tRaw('wanted.col_outcome')}</th>
      <th>${tRaw('wanted.col_rb_id')}</th>
      <th>${tRaw('wanted.col_set_color')}</th>
    </tr></thead><tbody>${ungeprueft(posten.map(zeile).join(''))}</tbody></table>`);
  fuelleFarbwahlen().catch(() => {});
}

/**
 * Die Farbauswahlen füllen — NACH dem Zeichnen.
 *
 * /v1/parts/brick-colors geht beim ersten Mal übers Netz; die Tabelle soll nicht darauf warten. Bis dahin
 * steht in jeder Auswahl „unverändert", und genau das ist die Vorgabe.
 */
async function fuelleFarbwahlen() {
  const farben = await loadBrickColors();
  if (!farben?.length) return;
  const opts = farben.map(c =>
    html`<option value="${c.id}" data-hex="${hexZiffern(c.hex)}">${colorName(c.name)}</option>`).join('');
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (G('wanted-xml-tabelle').querySelectorAll('select[data-change="wantedKorrekturFarbe"]'))) {
    const i = Number(sel.dataset.i);
    const gewaehlt = _korrekturen.get(i)?.rbFarbe;
    setzeHtml(sel, html`<option value="">${tRaw('wanted.keep')}</option>${ungeprueft(opts)}`);
    if (gewaehlt !== undefined && gewaehlt !== null) sel.value = String(gewaehlt);
  }
}

/** Eine eingetragene Rebrickable-Nummer merken (oder die Eintragung löschen). @this {unknown} */
function wantedKorrekturNummer() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const wert = el.value.trim();
  const k = { ..._korrekturen.get(i) };
  // Leeres Feld heisst „nichts eintragen", nicht „Nummer löschen": Der Server unterscheidet `undefined`
  // (nicht angefasst) von `null` (ausdrücklich geleert), und hier ist das erste gemeint.
  if (wert === '') delete k.rbId; else k.rbId = wert;
  setzeKorrektur(i, k);
}

/** @this {unknown} */
function wantedKorrekturFarbe() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const k = { ..._korrekturen.get(i) };
  if (el.value === '') delete k.rbFarbe; else k.rbFarbe = parseInt(el.value, 10);
  setzeKorrektur(i, k);
}

/**
 * Ein vorbefülltes Feld der Vorschau (Menge, Zustand, Kaufpreis). Ein eigener Handler, weil hier mit dem
 * Bericht verglichen wird statt auf leer geprüft: Wer den Ausgangswert zurücktippt, nimmt die Korrektur
 * zurück.
 * @this {unknown}
 */
function wantedKorrekturWert() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const name = el.dataset.feld;
  const p = _bericht?.posten?.[i];
  if (!p) return;
  const k = { ..._korrekturen.get(i) };
  const roh = el.value.trim();

  if (name === 'menge') {
    const m = parseInt(roh, 10);
    // Unbrauchbares nicht schicken: Der Server wiese die ganze Korrektur ab, und die Farbe daneben ginge mit
    // verloren. Das Feld zeigt stattdessen wieder, was gilt.
    if (!Number.isFinite(m) || m < 1) { el.value = String(k.menge ?? p.menge); return; }
    if (m === p.menge) delete k.menge; else k.menge = m;
  } else if (name === 'zustand') {
    const w = roh === '' ? null : roh;
    if (w === (p.zustand ?? null)) delete k.zustand; else k.zustand = w;
  } else if (name === 'kaufpreis') {
    const alt = p.maxPreis ?? null;
    /** @type {number | null} */
    let w = null;
    if (roh !== '') {
      const z = Number(roh);
      if (!Number.isFinite(z) || z < 0) {
        el.value = String(k.kaufpreis ?? alt ?? '');
        return;
      }
      // 0 ist „keiner", wie MAXPRICE=-1 in der Datei.
      w = z > 0 ? z : null;
    }
    if (w === alt) delete k.kaufpreis; else k.kaufpreis = w;
  } else return;

  setzeKorrektur(i, k);
}

/** @param {number} i @param {Record<string, string | number | null>} k */
function setzeKorrektur(i, k) {
  if (Object.keys(k).length === 0) _korrekturen.delete(i);
  else _korrekturen.set(i, k);
  const knopf = G('wanted-xml-schreiben');
  if (knopf) {
    // Die Zahl am Knopf, damit sichtbar ist, dass die Korrekturen mitgehen — sonst bleibt es ein Versprechen,
    // das man erst nachher prüfen kann.
    knopf.textContent = _korrekturen.size
      ? `${tRaw('settings.wanted_write')} (${_korrekturen.size})`
      : tRaw('settings.wanted_write');
  }
}

G('wanted-xml-modal')?.addEventListener('click',
  e => e.target === e.currentTarget && wantedXmlSchliessen());

// Das Symbol einmal hier an die drei Knöpfe hängen statt dreimal ins HTML. In ein eigenes <span> ohne
// data-i18n: Die Übersetzung setzt textContent und würfe es beim Sprachwechsel hinaus.
for (const el of document.querySelectorAll('[data-wanted-icon]')) setzeHtml(el, XML_ICON_SVG);

registerActions({
  wantedKorrekturFarbe,
  wantedKorrekturWert,
  wantedKorrekturNummer,
  wantedXmlGewaehlt,
  wantedXmlNeuLesen,
  wantedXmlSchliessen,
  wantedXmlSchreiben,
});
