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
//
// ── Warum eigene Datei ──────────────────────────────────────────────────────
//
// Der Import lag in 05-settings.js, weil der Knopf dort stand. Jetzt steht er
// in DREI Reitern, und der Dialog gehört in keinen von ihnen — er gehört zu
// der Sache, um die es geht.
import { registerActions } from './00-registry.js';
import { t, tRaw, colorName } from '../i18n.js';
import { ico, G, XML_ICON_SVG, api, esc, escHex, escUrl, fullUrl, hexZiffern, imgUrl, toast } from './01-core.js';
import { loadBrickColors, loadManualParts, loadManualFigsTable } from './06-minifigs.js';
import { loadGallery } from './02-gallery.js';

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
/**
 * Läuft gerade eine Anfrage an den Server?
 *
 * ── Marcos Vorgabe vom 20.10. ───────────────────────────────────────────────
 *
 * „Wenn der Import der Wanted-Liste läuft, soll der Button nicht nochmals
 *  geklickt werden können."
 *
 * Das ist nicht nur Kosmetik. Der zweite Schritt SCHREIBT, und er schreibt
 * über recordAcquisitionForDay() — eine zweite Anfrage mit derselben Datei
 * legt für denselben Tag keine zweite Erfassung an, sondern ADDIERT auf die
 * bestehende (idx_part_acq_tag_merkmale, utils/acquisitions.ts). Zwei Klicks auf
 * „Jetzt in den Bestand übernehmen" hätten also die doppelte Stückzahl
 * ergeben, und zwar lautlos: Beide Antworten melden Erfolg.
 *
 * Der Riegel liegt an ZWEI Stellen, weil ein Klick auf zwei Wegen ankommen
 * kann: `disabled` am Knopf (ein deaktivierter Knopf löst gar kein
 * click-Ereignis aus) und diese Abfrage in lies() selbst — gegen die
 * Tastatur-Eingabetaste, gegen den Dateiknopf daneben und gegen jeden
 * späteren Aufrufer, der den Knopf nicht kennt.
 */
let _laeuft = false;

/**
 * Welche Knöpfe sind jetzt bedienbar? EINE Stelle für die Regel.
 *
 * Vorher stand `schreibKnopf.disabled = !d.vorschau` mitten im Zeichnen des
 * Berichts. Käme der Riegel für „läuft gerade" als zweite Zuweisung daneben,
 * gäbe es zwei Stellen, die denselben Knopf schalten — und die eine würde die
 * andere irgendwann überschreiben (genau das passiert, wenn das Freigeben nach
 * dem Lauf den Knopf wieder einschaltet, den der Bericht gerade ausgeschaltet
 * hat).
 *
 * Deshalb: Der Zustand wird aus `_laeuft`, `_datei` und `_bericht` BERECHNET,
 * und jeder, der einen davon ändert, ruft diese Funktion.
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

/** Datei gewählt (in einem der drei Reiter) → Vorschau holen. */
async function wantedXmlGewaehlt() {
  const el = this instanceof HTMLElement ? this : null;
  if (!el?.files?.[0]) return;
  // Während ein Import läuft, keine neue Datei annehmen: Sie würde _datei
  // mitten im laufenden Schreiben austauschen. Der Knopf daneben lässt sich
  // sperren, dieser hier ist ein <label> um ein verstecktes Feld — er wird
  // nicht grau, also wird die Eingabe hier abgewiesen.
  if (_laeuft) { toast(tRaw('import.running'), 'info'); el.value = ''; return; }
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
  // Ohne Datei und ohne Bericht sind beide Knöpfe tot — beim nächsten Öffnen
  // schaltet die Vorschau sie wieder frei.
  knoepfeStand();
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
  if (!_datei || _laeuft) return;
  _laeuft = true;
  knoepfeStand();
  try {
    await liesWirklich(schreiben);
  } finally {
    // IMMER freigeben, auch wenn etwas geworfen hat: Ein Riegel, der nach
    // einem Fehler liegen bleibt, macht den Dialog unbrauchbar, bis man ihn
    // schliesst — und sieht aus wie ein hängender Import.
    _laeuft = false;
    knoepfeStand();
  }
}

/** Der eigentliche Lauf. Getrennt, damit der Riegel oben ein try/finally hat. */
/**
 * Den Fortschrittsbalken setzen — oder verstecken.
 *
 * ── Marcos Wunsch vom 20.10. ────────────────────────────────────────────────
 *
 * „kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
 *  anzeigen?"
 *
 * Der Balken sagt ZWEI Dinge, weil zwei verschiedene Dinge dauern: das
 * Nachfragen bei Rebrickable (eine Anfrage je 1,5 Sekunden) und das Schreiben
 * der Posten. Welche Phase läuft, steht als Satz darunter — ein Balken ohne
 * Beschriftung liesse offen, worauf man wartet.
 *
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
  // Dieselbe Zahl auch für Screenreader: Ein Balken, der nur breiter wird,
  // ist für sie gar keine Auskunft.
  G('wanted-xml-balken-wrap')?.setAttribute('aria-valuenow', String(anteil));
  const txt = G('wanted-xml-fortschritt-text');
  if (txt) {
    // tRaw und nicht t: Das Ziel ist textContent, und t() maskiert für HTML —
    // die Maskierung stünde als Zeichenfolge da (test/frontend-escaping.test.js).
    txt.textContent = tRaw(
      stand.phase === 'rebrickable' ? 'wanted.progress_rb' : 'wanted.progress_write',
      { done: stand.fertig, total: stand.gesamt });
  }
}

/**
 * Die Antwort ZEILENWEISE lesen (NDJSON) und dabei den Balken füllen.
 *
 * Der Server schickt mit `strom=1` erst Fortschrittszeilen und zuletzt den
 * Bericht — dieselbe Nutzlast wie ohne Strom (routes/api_v1/wanted.ts).
 *
 * ── Warum hier ein Rückfall steht ───────────────────────────────────────────
 *
 * `response.body` ist in jedem Browser da, den diese App bedient, aber nicht
 * in jeder Laufzeit, die diesen Code ausführt — die Prüfungen laden das Bündel
 * in eine Sandbox, und ein `fetch`-Ersatz dort liefert nur `json()`. Fehlt der
 * Strom, wird die letzte Zeile am Ende in einem Stück gelesen; der Balken
 * bleibt dann aus, der Import läuft trotzdem.
 *
 * @returns {Promise<object>} der Bericht (die letzte Zeile)
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

async function liesWirklich(schreiben) {
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
  // Der Fortschritt kostet nichts, wenn niemand hinsieht — aber hier sieht
  // jemand hin, also immer.
  p.set('strom', '1');

  zeichneFortschritt(null);
  let d;
  try {
    const r = await fetch(`/api/v1/wanted-list/import/xml?${p}`, { method: 'POST', body: fd });
    d = await liesStrom(r);
  } catch { d = {}; }
  zeichneFortschritt(null);
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
  // Der Knopfzustand kommt aus knoepfeStand() — siehe die Begründung dort.
  knoepfeStand();
  el.innerHTML = `
    <div style="border:1px solid var(--bdr);border-radius:8px;padding:.6rem">
      <div><strong>${d.gelesen}</strong> ${esc(tRaw('settings.wanted_read'))}${
        d.vorschau ? ` — ${esc(tRaw('settings.wanted_preview_only'))}` : ''}</div>
      ${stufe('zuordnung', tRaw('settings.wanted_s1'))}
      ${stufe('gleich_vermerkt', tRaw('settings.wanted_s2'))}
      ${stufe('katalogtreffer', tRaw('settings.wanted_s3'))}
      ${stufe('rebrickable', tRaw('settings.wanted_s4'))}
      ${stufe('korrigiert', tRaw('wanted.s_corrected'))}
      ${d.offen?.length ? `<div>${ico('warnung')} <strong>${d.offen.length}</strong> ${
        esc(tRaw('settings.wanted_open'))}</div>` : ''}
      ${d.farbeOffen ? `<div>${ico('warnung')} <strong>${d.farbeOffen}</strong> ${
        esc(tRaw('settings.wanted_color_open'))}</div>` : ''}
      ${Object.keys(d.fremdeArten || {}).length ? `<div>${ico('warnung')} ${
        esc(tRaw('settings.wanted_other_kinds'))}: ${
        esc(Object.entries(d.fremdeArten).map(([k, n]) => `${k}=${n}`).join(', '))}</div>` : ''}
      ${d.rebrickable ? `<div>${esc(tRaw('settings.wanted_rb_asked'))}: ${
        d.rebrickable.gefragt} → ${d.rebrickable.gefunden}</div>` : ''}
      ${d.korrekturen?.abgewiesen?.length ? `<div>${ico('warnung')} <strong>${
        d.korrekturen.abgewiesen.length}</strong> ${
        esc(tRaw('wanted.corrections_rejected'))}</div>` : ''}
      ${d.abgebrochen ? `<div>${ico('warnung')} ${esc(tRaw('wanted.cancelled'))}</div>` : ''}
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
  //
  // ── Vorschau und Import sagen dasselbe Wort verschieden ──────────────────
  //
  // `angelegt` heisst in der Vorschau „wird angelegt" und NACH dem Import
  // „angelegt". Hier stand nur die erste Fassung, und sie blieb auch dann
  // stehen, wenn geschrieben war: GEMESSEN am laufenden Server stand nach
  // einem Import von 60 Posten in jeder Zeile „will be added", während die
  // Zusammenfassung darüber „60 added" meldete. Zwei Sätze über dieselbe
  // Tatsache, und einer davon war falsch.
  //
  // Dieselbe Unterscheidung, die der Kern schon trifft (`vorschau` im
  // Bericht); nur dort, wo das Wort eine Zukunft behauptet.
  const kuenftig = !!_bericht?.vorschau;
  const ausgang = esc(tRaw(
    p.ausgang === 'angelegt' && !kuenftig ? 'wanted.out_angelegt_fertig'
                                          : `wanted.out_${p.ausgang}`) || p.ausgang);
  // Der Grund in der Sprache des Betrachters. `grund` vom Server ist ein
  // deutscher Satz — richtig fürs Protokoll, falsch in einer englischen
  // Tabelle (genau so am laufenden Server gesehen). Fehlt die Kennung (beim
  // Ausgang 'fehler' steht dort die Meldung der Ausnahme), bleibt der Satz.
  const grund = p.grundCode
    ? t(`wanted.grund_${p.grundCode}`, { farbe: p.blFarbe })
    : (p.grund ? esc(p.grund) : '');
  // ── Der Zustand, und woher er kommt (Marcos Bitte vom 20.10.) ────────────
  //
  //   „ja, bitte die Zustandsspalte noch in die Vorschau"
  //
  // `p.zustand` ist der Wert AUS DER DATEI: 'N', 'U' oder null. Null heisst
  // CONDITION=X („egal") oder gar keine Angabe — dann gilt der Standard des
  // Kontos, und genau DER wird angelegt. Die Spalte zeigt deshalb den
  // angelegten Zustand und sagt dazu, wenn er aus den Einstellungen stammt:
  // Ein „Gebraucht" ohne diesen Zusatz waere eine Aussage ueber die Datei,
  // die dort nicht steht.
  //
  // Der Standard kommt vom SERVER (bericht.standardZustand). Im Browser steht
  // er nirgends verlaesslich, und raten ist in einer Vorschau das Falsche.
  const zustandWert = p.zustand === 'N' || p.zustand === 'U'
    ? p.zustand : (_bericht?.standardZustand || null);
  const ausStandard = p.zustand !== 'N' && p.zustand !== 'U';
  const zustandZelle = zustandWert
    ? `<span class="cond-badge ${zustandWert === 'U' ? 'cond-used' : 'cond-new'}">${
        esc(tRaw(zustandWert === 'U' ? 'common.condition_used' : 'common.condition_new'))}</span>${
        ausStandard ? `<div style="color:var(--mut);font-size:var(--fs-1)">${
          esc(tRaw('wanted.cond_default'))}</div>` : ''}`
    : '';
  const korr = _korrekturen.get(i) || {};

  // ── Die Werte aus der Datei, bearbeitbar (Marcos Wunsch vom 21.10.) ──────
  //
  //   „Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
  //    vor dem Import korrigiert werden kann."
  //
  // Diese drei Felder sind VORBEFÜLLT — anders als die beiden Korrekturfelder
  // rechts, die leer anfangen. Daraus folgt eine andere Lesart: Dort heisst
  // leer „nicht angefasst", hier heisst JEDE Abweichung vom Ausgangswert eine
  // Korrektur (wantedKorrekturWert vergleicht mit dem Bericht).
  //
  // Nicht bearbeitbar bleiben Bild, Name, BrickLink-Nummer und Ergebnis — die
  // Begründung steht am Typ `Korrektur` in utils/wantedListe.ts.
  // `breit` wegen des Platzhalters „Marktpreis": In 72px stand dort „Marktpr"
  // — am Bildschirm gesehen.
  const feld = (name, wert, extra = '', breit = 72) =>
    `<input data-change="wantedKorrekturWert" data-feld="${name}" data-i="${i}"
       value="${esc(wert)}" ${extra}
       style="width:${breit}px;font-size:var(--fs-1);padding:2px 4px;border:1px solid var(--bdr);
              border-radius:5px;text-align:right" />`;
  const mengeZelle = feld('menge', korr.menge ?? p.menge, 'type="number" min="1" step="1"');
  // Der Preis je Stück. Leer heisst „keiner" — dann holt der Import den
  // Marktpreis, wie bei MAXPRICE=-1 in der Datei.
  const preisWert = korr.kaufpreis !== undefined ? (korr.kaufpreis ?? '') : (p.maxPreis ?? '');
  const preisZelle = feld('kaufpreis', preisWert,
    `type="number" min="0" step="0.0001" placeholder="${esc(tRaw('wanted.price_ph'))}"`, 96);
  // Der Zustand als Auswahl mit DREI Möglichkeiten: Der leere Wert ist keine
  // Lücke, sondern „Standard des Kontos" — dieselbe Aussage wie CONDITION=X.
  const zustandJetzt = korr.zustand !== undefined ? (korr.zustand ?? '') : (p.zustand ?? '');
  const wahl = (w, text) =>
    `<option value="${w}"${zustandJetzt === w ? ' selected' : ''}>${esc(text)}</option>`;
  const zustandWahl = `<select data-change="wantedKorrekturWert" data-feld="zustand" data-i="${i}"
      style="font-size:var(--fs-1);padding:2px;border:1px solid var(--bdr);border-radius:5px">
      ${wahl('', tRaw('wanted.cond_default_opt'))}
      ${wahl('N', tRaw('common.condition_new'))}
      ${wahl('U', tRaw('common.condition_used'))}
    </select>`;

  return `<tr${p.ausgang === 'offen' ? ' style="background:var(--s50)"' : ''}>
    <td>${bild}</td>
    <td style="font-family:monospace;font-size:var(--fs-1)">${esc(p.blId)}${
      p.rbId && p.rbId !== p.blId ? `<div style="color:var(--mut)">→ ${esc(p.rbId)}</div>` : ''}</td>
    <td style="font-size:var(--fs-2)">${esc(p.name || '')}${
      p.nameGeraten ? `<div style="color:var(--mut);font-size:var(--fs-1)">${
        esc(tRaw('wanted.name_guessed'))}</div>` : ''}</td>
    <td style="font-size:var(--fs-2);white-space:nowrap">${punkt}${esc(p.farbName || '')}${
      p.blFarbe !== null && !p.farbName
        ? `<span style="color:var(--mut)">BL ${p.blFarbe}</span>` : ''}</td>
    <td style="text-align:right">${mengeZelle}</td>
    <td style="font-size:var(--fs-1);white-space:nowrap">${zustandWahl}${
      // Die Plakette NUR bei „Standard": Dann sagt sie, was wirklich angelegt
      // wird — den Wert aus den Einstellungen, den die Auswahl nicht zeigen
      // kann. Steht dort N oder U, wiederholte sie bloss das Wort daneben
      // (am Bildschirm gesehen: „Gebraucht" über „Gebraucht").
      zustandJetzt === '' && zustandZelle
        ? `<div style="margin-top:2px">${zustandZelle}</div>` : ''}</td>
    <td style="text-align:right">${preisZelle}</td>
    <td style="font-size:var(--fs-1)">${ausgang}${
      grund ? `<div style="color:var(--mut);font-size:var(--fs-1)">${grund}</div>` : ''}</td>
    <td><input type="text" value="${esc(korr.rbId ?? '')}" placeholder="${
      esc(tRaw('wanted.rb_id_ph'))}" style="width:104px;font-size:var(--fs-1);padding:2px 4px;
      border:1px solid var(--bdr);border-radius:5px"
      data-change="wantedKorrekturNummer" data-i="${i}" /></td>
    <td><select data-change="wantedKorrekturFarbe" data-i="${i}"
      style="max-width:140px;font-size:var(--fs-1);padding:2px;border:1px solid var(--bdr);border-radius:5px">
      <option value="">${esc(tRaw('wanted.keep'))}</option></select></td>
  </tr>`;
}

function zeichneTabelle(d) {
  const el = G('wanted-xml-tabelle');
  if (!el) return;
  const posten = d.posten || [];
  if (!posten.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<table class="dt" style="font-size:var(--fs-2)"><thead><tr>
      <th>${t('col.image_th')}</th>
      <th>BrickLink</th>
      <th>${t('col.name')}</th>
      <th>${t('col.color')}</th>
      <th>${t('detail.qty')}</th>
      <th>${t('common.condition')}</th>
      <th>${t('detail.purchase_price')}</th>
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

/**
 * Ein VORBEFÜLLTES Feld der Vorschau — Menge, Zustand oder Kaufpreis.
 *
 * ── Marcos Wunsch vom 21.10. ───────────────────────────────────────────────
 *
 *   „Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
 *    vor dem Import korrigiert werden kann."
 *
 * ── Warum ein EIGENER Handler neben den beiden darüber ─────────────────────
 *
 * wantedKorrekturNummer/-Farbe bedienen Felder, die LEER anfangen: Dort heisst
 * ein leeres Feld „nicht angefasst", und jeder Inhalt ist eine Eintragung.
 * Diese drei sind vorbefüllt mit dem, was in der Datei steht — da gibt es
 * kein „leer" als Nicht-Aussage. Was zählt, ist die ABWEICHUNG vom
 * Ausgangswert; tippt jemand den alten Wert wieder hin, verschwindet die
 * Korrektur.
 *
 * Beides in einen Handler zu zwingen hiesse, die Unterscheidung in eine
 * Tabelle zu verstecken, die man beim Lesen erst auflösen muss. Zwei Lesarten
 * sind hier zwei Funktionen.
 *
 * Beim Zustand ist der leere Wert eine AUSSAGE („Standard des Kontos",
 * dieselbe wie CONDITION=X) und wird deshalb als `null` geschickt, nicht
 * weggelassen. Beim Preis ebenso: leer heisst „keiner, hol den Marktpreis".
 */
function wantedKorrekturWert() {
  const el = this instanceof HTMLElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const name = el.dataset.feld;
  const p = _bericht?.posten?.[i];
  if (!p) return;
  const k = { ..._korrekturen.get(i) };
  const roh = el.value.trim();

  if (name === 'menge') {
    const m = parseInt(roh, 10);
    // Unbrauchbares nicht schicken: Der Server wiese die ganze Korrektur ab,
    // und die Farbe daneben ginge mit verloren. Das Feld zeigt stattdessen
    // wieder, was gilt.
    if (!Number.isFinite(m) || m < 1) { el.value = String(k.menge ?? p.menge); return; }
    if (m === p.menge) delete k.menge; else k.menge = m;
  } else if (name === 'zustand') {
    const w = roh === '' ? null : roh;
    if (w === (p.zustand ?? null)) delete k.zustand; else k.zustand = w;
  } else if (name === 'kaufpreis') {
    const alt = p.maxPreis ?? null;
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

G('wanted-xml-modal')?.addEventListener('click',
  e => e.target.id === 'wanted-xml-modal' && wantedXmlSchliessen());

// ── Das Symbol an die drei Knöpfe hängen ───────────────────────────────────
//
// EINE Fassung für alle drei Reiter. Die Alternative wäre, das SVG dreimal in
// index.html zu schreiben — dieselbe Zeichnung an drei Stellen, von denen bei
// der nächsten Änderung zwei nachgezogen werden.
//
// Ein eigenes <span> ohne data-i18n: Die Übersetzung setzt textContent (siehe
// public/i18n.js) und würde ein Symbol im selben Element wieder herauswerfen,
// sobald die Sprache wechselt.
for (const el of document.querySelectorAll('[data-wanted-icon]')) el.innerHTML = XML_ICON_SVG;

registerActions({
  wantedKorrekturFarbe,
  wantedKorrekturWert,
  wantedKorrekturNummer,
  wantedXmlGewaehlt,
  wantedXmlNeuLesen,
  wantedXmlSchliessen,
  wantedXmlSchreiben,
});
