// ── Eigener Scrollbalken für die ganze Anwendung ────────────────────────────
//
// ── Warum eigene Datei (Nachtrag 136) ───────────────────────────────────────
//
// Lag ebenfalls in js/01-core.js und gehört zu keinem ihrer Themen. Braucht
// von aussen nur G() — den Rest macht er selbst.
import { G } from './01-core.js';

//
// Marcos Vorgabe: „Der rechte Scrollbalken ist der vom Browser, der durch den
// eigenen ersetzt werden soll. Gerne gleich in der ganzen App."
//
// Der des Browsers ist per CSS ausgeblendet; dieser hier sitzt an derselben
// Stelle, fest am rechten Fensterrand, und rollt die SEITE. Ein eigener
// Scrollkasten im Katalog (die vorige Fassung) hatte zwei Nachteile: Der Balken
// sass mitten im Fenster, und der Beobachter, der die Katalogseiten nachlädt,
// mass gegen diesen Kasten statt gegen das Fenster — beim Scrollen nach unten
// kam nichts nach.
//
// Das Etikett neben dem Griff füllt, wer es braucht: Der Katalog trägt dort
// eine Funktion ein, die das Jahr an der aktuellen Stelle liefert. Ohne
// Eintrag bleibt es leer, und der Balken ist ein gewöhnlicher Scrollbalken.

/** Wer beim Ziehen ein Etikett zeigen will, setzt hier eine Funktion. */
export let scrollLabelFn = null;
export function setScrollLabel(fn) { scrollLabelFn = fn; }

function _rollbarerBereich() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - window.innerHeight);
}

/** Griffgrösse und -lage aus dem Rollzustand — wie bei einem echten Balken. */
export function zeichneScrollbalken() {
  const bar = G('app-scrollbar'), thumb = G('app-scrollbar-thumb');
  if (!bar || !thumb) return;
  const rollbar = _rollbarerBereich();
  // Passt alles ins Fenster, gibt es nichts zu rollen — dann auch keinen Balken.
  if (rollbar < 8) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const spur = bar.clientHeight;
  const anteil = window.innerHeight / document.documentElement.scrollHeight;
  const hoehe = Math.max(32, Math.round(spur * anteil));
  const maxOben = Math.max(0, spur - hoehe);
  const fortschritt = window.scrollY / rollbar;
  thumb.style.height = hoehe + 'px';
  thumb.style.top = Math.round(maxOben * Math.min(1, Math.max(0, fortschritt))) + 'px';
}

/**
 * Das Balken-Element erzeugen, falls es noch nicht da ist.
 *
 * ── Warum aus JavaScript und nicht aus dem Markup ───────────────────────────
 * app.bundle.js ist ein KLASSISCHES Skript (kein Modul, kein defer) und läuft,
 * sobald der Parser es erreicht — also vor allem, was danach im Markup steht.
 * Genau daran ist die erste Fassung gescheitert: Das <div> stand am Ende des
 * Body, hinter dem Skript. Beim Start gab es das Element noch nicht,
 * initScrollbalken() kehrte still um, und weil der Balken des Browsers per CSS
 * verborgen ist, hatte die Anwendung GAR KEINEN mehr.
 *
 * Selbst erzeugt hängt der Balken an keiner Reihenfolge im HTML.
 */
function _erzeugeScrollbalken() {
  let bar = G('app-scrollbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'app-scrollbar';
    bar.style.display = 'none';
    bar.innerHTML = '<div id="app-scrollbar-thumb"></div><div id="app-scrollbar-label"></div>';
    document.body.appendChild(bar);
  }
  return bar;
}

export function initScrollbalken() {
  const bar = _erzeugeScrollbalken();
  const thumb = G('app-scrollbar-thumb'), label = G('app-scrollbar-label');
  if (!bar || !thumb) return;
  let ziehen = false, griffOffset = 0;

  // Gedrosselt über requestAnimationFrame: Ein Scroll-Ereignis feuert dutzende
  // Male je Sekunde, und zeichneScrollbalken() LIEST Layout (scrollHeight).
  // Ungedrosselt erzwingt das je Ereignis eine Neuberechnung — die Seite fühlt
  // sich dann zäh an, obwohl der Server längst geantwortet hat.
  let angefordert = false;
  const nachzeichnen = () => {
    if (angefordert) return;
    angefordert = true;
    requestAnimationFrame(() => { angefordert = false; zeichneScrollbalken(); });
  };
  window.addEventListener('scroll', nachzeichnen, { passive: true });
  window.addEventListener('resize', nachzeichnen, { passive: true });
  // Die Seitenhöhe ändert sich beim Nachladen von Kacheln, ohne dass gerollt
  // wird — ohne diese Beobachtung bliebe der Griff auf seiner alten Grösse.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(nachzeichnen).observe(document.body);
  }

  const rollen = (clientY) => {
    const r = bar.getBoundingClientRect();
    const hoehe = thumb.offsetHeight;
    const maxOben = Math.max(1, r.height - hoehe);
    const oben = Math.min(maxOben, Math.max(0, clientY - r.top - griffOffset));
    window.scrollTo({ top: (oben / maxOben) * _rollbarerBereich() });
    if (label) {
      const text = scrollLabelFn ? scrollLabelFn() : null;
      label.textContent = text || '';
      label.style.display = text ? 'block' : 'none';
      label.style.top = (oben + hoehe / 2) + 'px';
    }
  };
  const start = (ev) => {
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const tr = thumb.getBoundingClientRect();
    // Neben den Griff getippt: erst dorthin springen, dann greifen — wie bei
    // einem gewöhnlichen Scrollbalken.
    griffOffset = (y >= tr.top && y <= tr.bottom) ? y - tr.top : thumb.offsetHeight / 2;
    ziehen = true; bar.classList.add('dragging');
    rollen(y); ev.preventDefault();
  };
  const bewegen = (ev) => {
    if (!ziehen) return;
    rollen(ev.touches ? ev.touches[0].clientY : ev.clientY);
    ev.preventDefault();
  };
  const ende = () => {
    if (!ziehen) return;
    ziehen = false;
    bar.classList.remove('dragging');
    // Die INLINE gesetzte Sichtbarkeit wieder wegnehmen.
    //
    // Marcos Bild: Das Jahr „2027" stand in der Galerie oben rechts, ohne dass
    // jemand zog. Die CSS-Regel zeigt das Etikett nur während `.dragging` —
    // aber rollen() setzt `style.display` direkt am Element, und eine
    // Inline-Angabe schlägt jede Regel. Nach dem Loslassen blieb sie stehen,
    // also blieb auch das Etikett stehen, in JEDEM Reiter.
    if (label) label.style.display = '';
  };

  bar.addEventListener('mousedown', start);
  window.addEventListener('mousemove', bewegen);
  window.addEventListener('mouseup', ende);
  bar.addEventListener('touchstart', start, { passive: false });
  bar.addEventListener('touchmove', bewegen, { passive: false });
  bar.addEventListener('touchend', ende);
  zeichneScrollbalken();
}
