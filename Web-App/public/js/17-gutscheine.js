import { registerActions } from './00-registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { ico, G, TRASH_ICON_SVG, api, esc, fmtN, toast } from './01-core.js';
import { openPdfViewer } from './12-pdfviewer.js';

// ═══ Gutscheine (LEGO-Geschenkkarten) ══════════════════════════════════════
//
// ── Marcos Vorgabe ─────────────────────────────────────────────────────────
//
// „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
// Betrag hinterlegt werden können. […] Die Erfassung, Änderung und Anzeige
// soll sowohl in der Android-App als auch in der Webapp möglich sein und
// möglichst einfach erreichbar sein."
//
// Deshalb steht der Abschnitt direkt in den Profil-Einstellungen und nicht in
// einem eigenen Reiter: „möglichst einfach erreichbar" heisst hier, am selben
// Ort wie alles andere, was einem selbst gehört.
//
// ── Was hier NICHT passiert ────────────────────────────────────────────────
//
// Kein Auslesen des PDFs im Browser. Die Datei geht zum Server, der liest sie
// und schickt die Werte zurück. Das ist Marcos Vorgabe („die gleichen
// Services des Backends") und zugleich das einzig Sinnvolle: Eine zweite
// Fassung der Leselogik in JavaScript müsste mit der auf dem Server Schritt
// halten, und die Android-App bräuchte eine dritte.

/** Die zuletzt geladene Liste — für die Knöpfe, die auf eine Zeile zeigen. */
let _gutscheine = [];

/** Die id des Gutscheins, der gerade bearbeitet wird; null = neuer Eintrag. */
let _bearbeitet = null;

const el = (id) => document.getElementById(id);

// Die Handler nehmen die id als ERSTES Argument und kein Ereignis: Der
// Verteiler in 11-actions.js reicht `data-arg`, `data-arg2` … in dieser
// Reihenfolge durch und haengt das Ereignis ZULETZT an. Ein `(ev, id)` waere
// also still verdreht — die id landete in `ev`.

/**
 * Die PIN-Anzeige.
 *
 * Standardmässig verdeckt. Nicht aus Sicherheitsglauben — wer die Seite offen
 * hat, ist angemeldet und kann ihn einblenden —, sondern gegen die Schulter
 * daneben und gegen Bildschirmfotos: Eine Liste mit allen PINs im Klartext
 * ist genau das, was man nicht versehentlich herumzeigen will.
 */
const _sichtbar = new Set();

/**
 * Das Kopieren-Symbol — zwei Blaetter, wie ueberall sonst auch.
 *
 * Inline und nicht als Schriftzeichen: Ein Emoji sieht auf jedem System
 * anders aus und faellt bei manchen Schriften ganz aus. `currentColor` laesst
 * es die Farbe des Knopfes annehmen, also auch im Dunkelmodus.
 */
const KOPIE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function zeile(g) {
  const pinOffen = _sichtbar.has(g.id);
  // Die Nummer in Vierergruppen: 19 Ziffern am Stück sind beim Abtippen an
  // der Kasse nicht zu lesen, und genau dafür ist sie da. Kopiert wird
  // trotzdem die ROHE Nummer — mit Leerzeichen nimmt sie kein Bezahlfeld an.
  const nummer = String(g.number).replace(/(.{4})/g, '$1 ').trim();
  return `
    <div class="voucher-row" data-id="${g.id}">
      <div class="voucher-main">
        <div class="voucher-num-row">
          <span class="voucher-num" title="${esc(g.number)}">${esc(nummer)}</span>
          <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="nummer"
                  title="${tRaw('vouchers.copy_number')}"
                  aria-label="${tRaw('vouchers.copy_number')}">${KOPIE_ICON_SVG}</button>
        </div>
        <div class="voucher-meta">
          <span class="voucher-amount">${fmtN(g.amount, g.currency)}</span>
          <!-- Der Stand NEBEN dem Betrag, nicht statt ihm: „250 CHF" allein
               ist keine Auskunft, „250 CHF, abgefragt am 15.10." ist eine.
               Und eine Karte, deren Guthaben noch nie abgefragt wurde, sagt
               das — im WORT, nicht durch eine Farbe. -->
          <span class="voucher-stand">${g.guthaben_geprueft_am
            ? t('vouchers.balance_as_of',
                { datum: new Date(g.guthaben_geprueft_am).toLocaleDateString(locale()) })
            : t('vouchers.balance_never')}</span>
        </div>
      </div>
      <div class="voucher-pin">
        <span class="voucher-pin-label">${t('vouchers.pin')}</span>
        <code>${g.pin ? (pinOffen ? esc(g.pin) : '••••') : '–'}</code>
        ${g.pin ? `<button class="v-btn" data-click="gutscheinPinUmschalten" data-arg="${g.id}"
                     title="${tRaw(pinOffen ? 'vouchers.pin_hide' : 'vouchers.pin_show')}"
                     aria-label="${tRaw(pinOffen ? 'vouchers.pin_hide' : 'vouchers.pin_show')}">
                     ${ico(pinOffen ? 'auge-zu' : 'auge')}</button>
                   <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="pin"
                     title="${tRaw('vouchers.copy_pin')}"
                     aria-label="${tRaw('vouchers.copy_pin')}">${KOPIE_ICON_SVG}</button>` : ''}
      </div>
      <div class="voucher-actions">
        <!-- Guthaben abfragen. NUR mit PIN: LEGO fragt Nummer UND PIN ab, und
             ein Knopf, der ohne PIN immer dieselbe Absage erzeugt, waere eine
             Falle. Ohne PIN steht in der Zeile ohnehin schon „–". -->
        ${g.pin ? `
          <button class="v-btn" data-click="guthabenAbfragen" data-arg="${g.id}"
                  title="${tRaw('vouchers.balance_one')}"
                  aria-label="${tRaw('vouchers.balance_one')}">${ico('aktualisieren')}</button>` : ''}
        ${g.hat_pdf ? `
          <button class="v-btn" data-click="gutscheinPdfOeffnen" data-arg="${g.id}"
                  title="${tRaw('vouchers.pdf_open')}"
                  aria-label="${tRaw('vouchers.pdf_open')}">${ico('datei')}</button>`
        : `<span class="voucher-nopdf" title="${tRaw('vouchers.no_pdf')}">—</span>`}
        <button class="v-btn" data-click="gutscheinBearbeiten" data-arg="${g.id}"
                title="${tRaw('vouchers.edit_title')}">${ico('bearbeiten')}</button>
        <button class="delbtn" data-click="gutscheinLoeschen" data-arg="${g.id}"
                title="${tRaw('vouchers.delete_title')}">${TRASH_ICON_SVG}</button>
      </div>
    </div>`;
}

/** Die Liste laden und zeichnen. */
export async function ladeGutscheine() {
  const liste = el('vouchers-list');
  if (!liste) return;
  const d = await api('GET', '/v1/vouchers');
  if (!d?.success) { liste.innerHTML = `<div class="voucher-leer">${t('vouchers.load_error')}</div>`; return; }
  _gutscheine = d.vouchers || [];
  liste.innerHTML = _gutscheine.length
    ? _gutscheine.map(zeile).join('')
    : `<div class="voucher-leer" data-i18n="vouchers.empty">${t('vouchers.empty')}</div>`;

  // Die Summe. Nur wenn alle dieselbe Währung haben — sonst stünde dort eine
  // Zahl, die nichts bedeutet. Gemischte Währungen zusammenzuzählen wäre
  // schlimmer als gar keine Summe, weil es richtig aussieht.
  const summeEl = el('vouchers-total');
  if (summeEl) {
    const waehrungen = new Set(_gutscheine.map(g => g.currency));
    summeEl.textContent = (_gutscheine.length && waehrungen.size === 1)
      ? fmtN(_gutscheine.reduce((s, g) => s + g.amount, 0), [...waehrungen][0])
      : '';
  }
}

function formularLeeren() {
  _bearbeitet = null;
  for (const id of ['v-number', 'v-pin', 'v-amount']) { const e = el(id); if (e) e.value = ''; }
  const datei = el('v-pdf'); if (datei) datei.value = '';
  const titel = el('vouchers-form-title');
  if (titel) titel.textContent = tRaw('vouchers.add');
  const abbrechen = el('v-cancel');
  if (abbrechen) abbrechen.style.display = 'none';
}

export function gutscheinBearbeiten(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  _bearbeitet = g.id;
  el('v-number').value = g.number;
  el('v-pin').value    = g.pin || '';
  el('v-amount').value = g.amount;
  const cur = el('v-currency'); if (cur) cur.value = g.currency;
  el('vouchers-form-title').textContent = tRaw('vouchers.edit');
  el('v-cancel').style.display = '';
  // Die Datei bleibt, wie sie ist: Ein Gutschein bekommt sein PDF beim
  // Anlegen. Es nachträglich auszutauschen wäre ein eigener Vorgang und
  // beantwortet keine Frage, die jemand hat.
  el('v-pdf').parentElement.style.display = 'none';
  el('v-number').focus();
}

export function gutscheinAbbrechen() {
  formularLeeren();
  el('v-pdf').parentElement.style.display = '';
}

/**
 * Speichern — der eine Knopf für beide Wege.
 *
 * Liegt eine Datei im Feld, geht sie mit: Dann liest der Server die Werte und
 * die ausgefüllten Felder gewinnen gegen das Gelesene. Liegt keine da, ist es
 * eine ganz gewöhnliche manuelle Erfassung. Marcos „entweder … oder" ist
 * damit kein Entweder-oder in der Bedienung — man kann ein PDF hochladen UND
 * den Betrag selbst eintragen, wenn das PDF ihn nicht hergibt.
 */
export async function gutscheinSpeichern() {
  const number   = el('v-number').value.trim();
  const pin      = el('v-pin').value.trim();
  const amount   = el('v-amount').value.trim();
  const currency = el('v-currency')?.value || 'CHF';
  const datei    = el('v-pdf')?.files?.[0] || null;

  if (_bearbeitet) {
    const d = await api('PUT', `/v1/vouchers/${_bearbeitet}`, { number, pin, amount, currency });
    if (!d?.success) { toast(d?.error || tRaw('vouchers.save_error'), 'error'); return; }
    toast(tRaw('vouchers.saved'), 'success');
    formularLeeren(); el('v-pdf').parentElement.style.display = '';
    await ladeGutscheine();
    return;
  }

  if (datei) {
    // FormData statt api(): Der Helfer schickt JSON. Eine Datei geht nur als
    // multipart, und `Content-Type` setzt der Browser dabei selbst (samt
    // boundary) — ihn hier zu setzen, zerbricht die Anfrage.
    const form = new FormData();
    form.append('file', datei);
    // Nur ausgefüllte Felder mitschicken: Ein leeres Feld würde das aus dem
    // PDF Gelesene überschreiben — mit nichts.
    if (number)   form.append('number', number);
    if (pin)      form.append('pin', pin);
    if (amount)   form.append('amount', amount);
    if (currency) form.append('currency', currency);
    let r, d;
    try {
      r = await fetch('/api/v1/vouchers/pdf', { method: 'POST', body: form });
      d = await r.json();
    } catch { toast(tRaw('vouchers.save_error'), 'error'); return; }

    if (r.status === 422) {
      // Das PDF gab nicht genug her. Was gelesen WURDE, wird eingetragen —
      // der Nutzer ergänzt den Rest und drückt noch einmal, mit derselben
      // Datei. Das ist der Unterschied zwischen „hat nicht geklappt" und
      // „hier fehlt noch der Betrag".
      const g = d?.gelesen || {};
      if (g.number && !number)     el('v-number').value = g.number;
      if (g.pin && !pin)           el('v-pin').value = g.pin;
      if (g.amount != null && !amount) el('v-amount').value = g.amount;
      if (g.currency && el('v-currency')) el('v-currency').value = g.currency;
      toast(tRaw('vouchers.pdf_incomplete'), 'error');
      return;
    }
    if (!d?.success) { toast(d?.error || tRaw('vouchers.save_error'), 'error'); return; }

    // ── Ein PDF, zwei mögliche Antworten ────────────────────────────────────
    //
    // Marcos Vorgabe: „Wenn ein PDF mit mehreren Seiten selektiert wird,
    // sollen mehrere Gutscheine erfasst werden." Welcher Fall es ist,
    // entscheidet der SERVER — er liest die Datei. Hier wird nur die Antwort
    // gezeigt, und `mehrere` sagt, welche es ist.
    //
    // Dieselben Felder wie bei den CSV-Importen (added/updated/errors), also
    // dieselbe Meldung: Wer drei Gutscheine auf einmal erfasst, soll nicht
    // „Gutschein gespeichert" lesen und raten, wie viele es wurden.
    if (d.mehrere) {
      toast(tRaw('import.summary', { added: d.mehrere.added, updated: d.mehrere.updated,
                                     errors: d.mehrere.errors }),
        d.mehrere.errors ? 'info' : 'success');
    } else {
      toast(tRaw('vouchers.saved'), 'success');
    }
    formularLeeren();
    await ladeGutscheine();
    return;
  }

  const d = await api('POST', '/v1/vouchers', { number, pin, amount, currency });
  if (!d?.success) { toast(d?.error || tRaw('vouchers.save_error'), 'error'); return; }
  toast(tRaw('vouchers.saved'), 'success');
  formularLeeren();
  await ladeGutscheine();
}

export async function gutscheinLoeschen(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  if (!confirm(tRaw('vouchers.delete_confirm', { nummer: g.number }))) return;
  const d = await api('DELETE', `/v1/vouchers/${id}`);
  if (!d?.success) { toast(d?.error || tRaw('vouchers.delete_error'), 'error'); return; }
  toast(tRaw('vouchers.deleted'), 'success');
  await ladeGutscheine();
}

export function gutscheinPinUmschalten(id) {
  const n = Number(id);
  if (_sichtbar.has(n)) _sichtbar.delete(n); else _sichtbar.add(n);
  ladeGutscheine();
}

/**
 * Das PDF im Betrachter der App — derselbe wie bei den Bauanleitungen.
 *
 * ── Marcos Vorgabe ─────────────────────────────────────────────────────────
 *
 *   „Die beiden Buttons PDF Download und PDF im neuen Fenster öffnen
 *    entfernen und durch den PDF-Viewer der Anleitungen ersetzen → Analog wie
 *    es in der Android-App umgesetzt ist."
 *
 * Hier standen zwei Knöpfe: `window.open` für die Anzeige und ein zweiter
 * mit `?download=1` für das Herunterladen. Beide sind entfallen, und zwar
 * ersatzlos — der Betrachter trägt seinen Download-Knopf selbst
 * (`pdf-viewer-download` in index.html, er bekommt dieselbe Adresse).
 * Zwei Knöpfe für eine Sache waren eine Zeile Platz und eine Entscheidung
 * zu viel.
 *
 * Damit verhalten sich beide Apps gleich: Die Android-App zeigt Gutschein-
 * PDFs im PdfViewerScreen, demselben, der auch Anleitungen und Teilelisten
 * zeigt. Genau das meint „analog".
 */
export function gutscheinPdfOeffnen(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  openPdfViewer(`/api/v1/vouchers/${id}/pdf`, g ? g.number : 'PDF');
}

/**
 * Gutscheinnummer oder PIN in die Zwischenablage.
 *
 * ── Marcos Vorgabe ─────────────────────────────────────────────────────────
 *
 *   „Kannst du in der Webapp hinter den Gutscheincode und den Pin jeweils
 *    einen Kopieren Button einfügen (mit einem Icon)."
 *
 * Kopiert wird die ROHE Nummer, nicht die mit Leerzeichen gruppierte Anzeige:
 * Die Gruppierung ist eine Lesehilfe fürs Abtippen an der Kasse — ein
 * Bezahlfeld nimmt sie nicht an.
 *
 * `navigator.clipboard` braucht einen sicheren Kontext (HTTPS oder
 * localhost). Auf einem Server, der nur über HTTP läuft, fehlt das Objekt
 * ganz; deshalb der Rückfall über ein unsichtbares Textfeld und
 * `execCommand('copy')`. Das ist veraltet, aber es ist der einzige Weg, der
 * dort noch funktioniert — und ein Kopieren-Knopf, der auf halben Servern
 * stumm nichts tut, wäre schlimmer als sein Fehlen.
 */
export async function gutscheinKopieren(id, feld) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  const wert = feld === 'pin' ? (g.pin || '') : String(g.number);
  if (!wert) return;
  let geklappt = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(wert); geklappt = true; }
  } catch { geklappt = false; }
  if (!geklappt) {
    try {
      const feldchen = document.createElement('textarea');
      feldchen.value = wert;
      // Ausserhalb des Bildes statt `display:none`: Ein verstecktes Element
      // lässt sich nicht markieren, und ohne Markierung kopiert execCommand
      // nichts.
      feldchen.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(feldchen);
      feldchen.select();
      geklappt = document.execCommand('copy');
      feldchen.remove();
    } catch { geklappt = false; }
  }
  toast(tRaw(geklappt
    ? (feld === 'pin' ? 'vouchers.copied_pin' : 'vouchers.copied_number')
    : 'vouchers.copy_error'), geklappt ? 'success' : 'error');
}

/**
 * Alle Gutscheine als EIN PDF herunterladen.
 *
 * ── Warum fetch und kein Link ───────────────────────────────────────────────
 *
 * Die Antwort trägt neben dem PDF eine Kopfzeile `X-Gutschein-Befunde`: je
 * Gutschein, ob der Betrag ersetzt wurde, schon stimmte, unverändert blieb
 * (mit Grund) oder die Seite erzeugt wurde. Ein `<a href>` bekäme die Datei
 * und würde die Auskunft wegwerfen — und genau die ist hier wichtig: Ein
 * Gutschein, dessen Betrag NICHT ersetzt werden konnte, zeigt auf dem Papier
 * den alten Wert. Das muss dastehen, nicht verschwiegen werden.
 *
 * ── Was hier NICHT mehr steht (Marcos Durchsicht vom 15.10.) ───────────────
 *
 * Die Liste der Befunde unter den Knöpfen. Sie zeigte „⚠ …: Der Betrag im PDF
 * stimmt schon" — also eine Warnung davor, dass alles in Ordnung ist. Der
 * Fehler lag nicht in dieser Anzeige, sondern eine Schicht tiefer: „stimmte
 * schon" und „liess sich nicht ersetzen" trugen dieselbe Art. Seit es
 * 'stimmte_schon' gibt (utils/gutscheinPdfSchreiben.ts), zählt `offen` nur
 * noch das, was wirklich offen ist — und das sagt die Meldung.
 */
async function gutscheineExportieren() {
  toast(tRaw('vouchers.export_running'), 'info');
  try {
    const r = await fetch('/api/v1/vouchers/export/pdf');
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || tRaw('settings.error'), 'error');
      return;
    }
    const blob = await r.blob();
    let befunde = [];
    try {
      const kopf = r.headers.get('X-Gutschein-Befunde');
      if (kopf) befunde = JSON.parse(atob(kopf));
    } catch { /* ohne Befunde ist das PDF trotzdem gut */ }

    // Herunterladen über ein kurzlebiges Objekt-URL: Der Name kommt aus dem
    // Content-Disposition, falls er lesbar ist, sonst aus dem Datum.
    const name = (r.headers.get('Content-Disposition') || '')
      .match(/filename="([^"]+)"/)?.[1]
      || `brickinventory-gutscheine-${new Date().toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    // Die Befunde: 'unveraendert' heisst jetzt genau eines — es hätte
    // ersetzt werden sollen und ging nicht. „Stimmte schon" ist eine eigene
    // Art und kein offener Punkt mehr.
    const offen = befunde.filter(b => b.art === 'unveraendert' && b.grund);
    if (!offen.length) {
      toast(tRaw('vouchers.export_done', { n: befunde.length }), 'success');
    } else {
      // tRaw und nicht t: Das Ziel ist ein TOAST, also reiner Text. t()
      // maskiert die eingesetzten Werte, und die Maskierung erscheint dort
      // WOERTLICH — aus 9'325 wurde im Katalog sichtbar „9&#39;325".
      // test/frontend-escaping.test.js faengt genau das, und es hat es
      // gefangen: Mein erster Entwurf stand hier mit t().
      // Die Nummern stehen IN der Meldung: Ohne sie wüsste niemand, welche
      // Karte auf dem Papier den alten Betrag trägt — und eine Liste, die
      // dauerhaft unter den Knöpfen steht, will Marco nicht.
      toast(tRaw('vouchers.export_done', { n: befunde.length }) + ' — '
          + tRaw('vouchers.export_offen', { n: offen.length }) + ': '
          + offen.map(b => b.number).join(', '), 'info');
    }
  } catch (e) {
    toast(tRaw('settings.error'), 'error');
  }
}

// ═══ Guthaben bei LEGO abfragen ════════════════════════════════════════════
//
// ── Marcos Vorgaben ────────────────────────────────────────────────────────
//
// „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
//  abgefragt und gespeichert werden kann?"
//
// „Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt werden
//  kann. (über alle Benutzer)"
//
// ── Warum die OBERFLÄCHE taktet und nicht der Server ───────────────────────
//
// Die Grenze selbst steht auf dem Server (utils/gutscheinGuthabenSchranke.ts)
// und gilt dort für alle Benutzer und alle Arbeitsprozesse — hier wird sie
// nicht nachgebaut, sondern BEFOLGT: Kommt 429 mit `wartenSek`, wartet diese
// Schleife die Zeit ab und fragt dieselbe Karte erneut.
//
// Eine Sammelroute auf dem Server hätte dieselbe Wartezeit innerhalb EINER
// HTTP-Anfrage absitzen müssen — bei fünf Karten über zwei Minuten mit offener
// Verbindung. Die Begründung steht ausführlich an der Route.
//
// Und deshalb zählt der Fortschritt mit: Wer „alle abfragen" drückt, wartet
// Minuten, und ein Knopf, der nur ausgegraut ist, sagt ihm nicht, ob noch
// etwas passiert.

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
const ABSTAND_VERSUCHE = 4;

const _warte = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Sekunden abwarten und dabei herunterzählen.
 *
 * Der Text nennt die Karte: Bei „alle abfragen" ist sonst nicht zu sehen,
 * wofür gewartet wird.
 */
async function warteSichtbar(sekunden, nummer) {
  const status = G('vouchers-balance-status');
  for (let rest = sekunden; rest > 0; rest--) {
    if (status) status.textContent = tRaw('vouchers.balance_wait', { sek: rest, nummer });
    await _warte(1000);
  }
}

/**
 * Eine Karte abfragen — ohne Takten, ohne Neuladen.
 *
 * Gibt zurück, was der Aufrufer wissen muss: ob es geklappt hat, und wenn
 * nicht, ob es am Abstand lag (dann lohnt Warten) oder am Bot-Schutz (dann
 * wird AUFGEHÖRT — weiterzufragen ist genau das, was nicht sein soll).
 */
async function eineAbfrage(id) {
  const d = await api('POST', `/v1/vouchers/${id}/guthaben`);
  if (d?.success) return { art: 'ok', antwort: d };
  if (d?.grund === 'abstand' && Number(d.wartenSek) > 0) {
    return { art: 'abstand', wartenSek: Number(d.wartenSek) };
  }
  if (d?.grund === 'botschutz') {
    return { art: 'botschutz', fehler: d.error || tRaw('settings.error') };
  }
  return { art: 'fehler', fehler: d?.error || tRaw('settings.error') };
}

/** Was eine erfolgreiche Abfrage dem Nutzer sagt. */
function meldeErfolg(antwort) {
  const v = antwort.voucher;
  toast(tRaw('vouchers.balance_done', {
    nummer: v.number,
    betrag: antwort.angezeigt || fmtN(v.amount, v.currency),
  }), 'success');
  // Eine stillschweigend geänderte Währung wäre eine geänderte Summe ohne
  // Hinweis — die Liste rechnet nur, wenn alle Gutscheine dieselbe tragen.
  if (antwort.waehrung_geaendert) {
    toast(tRaw('vouchers.balance_currency', { waehrung: v.currency }), 'info');
  }
}

/** Eine Karte, auf Knopfdruck in ihrer Zeile. */
export async function guthabenAbfragen(id) {
  const status = G('vouchers-balance-status');
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (status) status.textContent = tRaw('vouchers.balance_running');
  for (let versuch = 1; ; versuch++) {
    const r = await eineAbfrage(id);
    if (r.art === 'ok') {
      if (status) status.textContent = '';
      meldeErfolg(r.antwort);
      await ladeGutscheine();
      return;
    }
    if (r.art === 'abstand' && versuch < ABSTAND_VERSUCHE) {
      await warteSichtbar(r.wartenSek, g ? g.number : '');
      continue;
    }
    if (status) status.textContent = '';
    // Auch der Abstand wird hier zur Fehlermeldung: Nach vier Versuchen ist
    // die Auskunft „es ist belegt" ehrlicher als weiteres Warten.
    toast(r.fehler || tRaw('settings.error'), 'error');
    return;
  }
}

/** Alle Karten mit PIN, eine nach der anderen. */
export async function guthabenAlleAbfragen() {
  const status = G('vouchers-balance-status');
  const dran = _gutscheine.filter(g => g.pin);
  if (!dran.length) {
    toast(tRaw('vouchers.balance_keine'), 'info');
    return;
  }
  let fertig = 0, fehler = 0;
  for (const g of dran) {
    let erledigt = false;
    for (let versuch = 1; !erledigt && versuch <= ABSTAND_VERSUCHE; versuch++) {
      if (status) {
        status.textContent = tRaw('vouchers.balance_progress',
          { n: fertig + fehler + 1, total: dran.length, nummer: g.number });
      }
      const r = await eineAbfrage(g.id);
      if (r.art === 'ok') { fertig++; meldeErfolg(r.antwort); erledigt = true; break; }
      if (r.art === 'abstand') { await warteSichtbar(r.wartenSek, g.number); continue; }
      fehler++;
      toast(r.fehler, 'error');
      erledigt = true;
      // Bot-Schutz: HIER wird abgebrochen, nicht nur diese Karte übersprungen.
      // Die übrigen Karten liefen in dieselbe Wand, und Marcos Vorgabe ist,
      // dass dann „nicht mehr Aufrufe generiert werden".
      if (r.art === 'botschutz') {
        if (status) status.textContent = '';
        await ladeGutscheine();
        return;
      }
    }
    if (!erledigt) { fehler++; toast(tRaw('vouchers.balance_belegt'), 'error'); }
  }
  if (status) status.textContent = '';
  toast(tRaw('vouchers.balance_alle_fertig', { fertig, fehler }),
    fehler ? 'info' : 'success');
  await ladeGutscheine();
}

/**
 * Das Ausgabeland speichern — eine globale Einstellung.
 *
 * Eigener Weg und nicht der große Speichern-Knopf der Einstellungsseite: Das
 * Feld steht in der Gutschein-Rubrik, und wer dort etwas wählt, erwartet, dass
 * es gilt. Der Server nimmt den Wert nur von einem Verwalter an — deshalb ist
 * das Feld für alle anderen gar nicht sichtbar (`admin-only` in index.html).
 */
export async function gutscheinLandSpeichern() {
  const feld = el('gutschein-land');
  if (!feld) return;
  const d = await api('POST', '/v1/settings', { gutschein_land: feld.value });
  toast(d?.success ? tRaw('settings.saved') : (d?.error || tRaw('settings.error')),
    d?.success ? 'success' : 'error');
}

registerActions({
  gutscheineExportieren,
  ladeGutscheine,
  gutscheinSpeichern,
  gutscheinBearbeiten,
  gutscheinAbbrechen,
  gutscheinLoeschen,
  gutscheinPinUmschalten,
  gutscheinPdfOeffnen,
  gutscheinKopieren,
  guthabenAbfragen,
  guthabenAlleAbfragen,
  gutscheinLandSpeichern,
});
