import { registerActions } from './00-registry.js';
import { esc } from './00-escapen.js';
import { abonniere, melde } from './00-ereignisse.js';
import { LANG, applyLang, locale, tRaw } from '../i18n.js';
import { CURRENCY, _settingsCache, ME } from './00-zustand.js';

// ═══ Escaping, Werkzeuge, api(), i18n-Glue, Auth & Panels, Login/Logout ═══
//
// Was NICHT (mehr) hier steht, obwohl es hier stand:
//   Kontofilter                    → js/14-scope.js
//   eigener Scrollbalken           → js/15-scrollbar.js
//   PDF-Betrachter                 → js/12-pdfviewer.js
//   CSV-Import-Fortschrittsbalken  → js/01-fortschritt.js
//   Überwachung und Protokollfenster → js/01-monitor.js
//
// Diese Liste ist kein Verzeichnis, sondern eine Warnung: Die Datei war
// zweimal auf über 1300 Zeilen gewachsen, weil Neues dort angehängt wurde, wo
// gerade jemand las. Was hier hineingehört, steht in der Zeile darüber — alles
// andere bekommt eine eigene Datei, auch wenn es klein anfängt.

// ── ESCAPING ───────────────────────────────────────────────────────────────
// Alle Listen und Detailansichten werden per innerHTML aus Template-Literalen
// gebaut. Jeder Wert, der aus der DB, einem CSV-Import oder einer Fremd-API
// kommt, MUSS deshalb durch einen dieser Helfer — sonst ist jedes freie
// Textfeld (Teilename, Farbname, Notiz, Bild-URL) ein Stored-XSS-Vektor.
// Faustregel:
//   Textinhalt oder doppelt-gequotetes Attribut  → esc()
//   Wert in einem JS-String im Attribut          → escJs()   z.B. data-click="fn" data-arg="${escJs(x)}"
//   src / href                                   → escUrl()
//   Farbwert in data-farbe=""                    → escHex()

/** HTML-Escape für Textinhalte und doppelt-gequotete Attributwerte. */
/**
 * Wie kurz ein Passwort hoechstens sein darf — dieselbe Zahl wie im Server
 * (PASSWORT_MIN_ZEICHEN in src/konto/auth.ts) und in der App.
 *
 * Sie steht hier ZUSAETZLICH und nicht statt dessen: Der Server ist die
 * Instanz, die es durchsetzt, der Browser der, der es dem Nutzer sagt, bevor
 * er auf Speichern drueckt. Dass sie damit an drei Orten steht, ist
 * unvermeidbar (drei Laufzeiten) — test/passwortlaenge.test.js haelt sie
 * zusammen, damit aus „unvermeidbar" nicht „auseinandergelaufen" wird.
 */
export const PASSWORT_MIN_ZEICHEN = 8;

/**
 * Ist dieses Passwort zu kurz?
 *
 * ── Warum es das hier ueberhaupt gibt ───────────────────────────────────────
 * Nachgemessen: Die Webapp prueft die Laenge an KEINER ihrer fuenf Stellen,
 * die ein Passwort setzen (Registrieren, Zuruecksetzen, Aendern, Konto
 * anlegen, Konto-Passwort zuruecksetzen). Die Android-App prueft sie in ihrer
 * Oberflaeche sehr wohl (SettingsScreen, LoginScreen) — die beiden
 * Oberflaechen verhielten sich also unterschiedlich, und die Webapp lief in
 * einen Serverfehler, wo die App den Knopf gar nicht erst freigibt.
 */
export function passwortZuKurz(p){ return String(p ?? '').length < PASSWORT_MIN_ZEICHEN; }

/** Die Meldung dazu — an fuenf Stellen dieselbe. */
export function passwortZuKurzText(){
  return tRaw('settings.password.too_short', { n: PASSWORT_MIN_ZEICHEN });
}

/** bcrypt liest 72 Byte; dieselbe Grenze wie PASSWORT_MAX_BYTE im Server. */
export const PASSWORT_MAX_BYTE = 72;

/** Was der Browser vor dem Absenden prüfen kann, als Meldung, sonst null. Die
 * Liste häufiger Passwörter kennt nur der Server; seine Meldung kommt zurück. */
export function passwortRegelText(p){
  if (passwortZuKurz(p)) return passwortZuKurzText();
  if (new TextEncoder().encode(String(p)).length > PASSWORT_MAX_BYTE) return tRaw('settings.password.too_long', { n: PASSWORT_MAX_BYTE });
  return null;
}

// esc() steht seit dem 20.10. in js/00-escapen.js — DOM-frei, damit auch der
// BrickLink-Export es benutzen kann, ohne diese Datei zu laden. Die Begründung
// steht dort. Weitergereicht wird es hier, damit jeder bestehende
// `import { esc } from './01-core.js'` unverändert gilt.
export { esc };

/**
 * Wert in einem einfach-gequoteten JS-String innerhalb eines doppelt-gequoteten
 * HTML-Attributs: data-click="fn" data-arg="${escJs(x)}".
 * Reihenfolge zählt — erst JS-escapen (Backslash, Apostroph), dann HTML.
 * Ein blosses esc() reicht hier NICHT: es lässt den Apostroph als &#39; stehen,
 * der Browser dekodiert ihn vor dem JS-Parsen zurück und der String bricht auf.
 */
export function escJs(s){
  return String(s ?? '')
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * src/href: nur relative Pfade und http(s) durchlassen. Manuell erfasste Teile
 * und Minifiguren dürfen eine Bild-URL mitbringen — ohne diese Prüfung landet
 * "javascript:…" ungefiltert in einem href.
 */
export function escUrl(u){
  const v = String(u ?? '').trim();
  if (!v) return '';
  if (!/^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(v)) return '';
  return esc(v);
}

/** Farbwert für data-farbe="…" (js/00-stile.js) — alles ausser 6 Hex-Ziffern fliegt raus. */
export function escHex(hex, fallback){
  const v = String(hex ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? '#' + v : (fallback || 'var(--s300)');
}

/**
 * Dieselbe Prüfung wie [escHex], aber OHNE das Doppelkreuz.
 *
 * Für Attribute, die den nackten Farbwert tragen und deren Leser das `#`
 * selbst ergänzen — `data-hex` in der Farbauswahl ist so eines:
 *
 *     dot.style.background = hex ? '#' + hex : 'var(--s200)';
 *
 * escHex() dort einzusetzen hätte beide Leser gebrochen (`##RRGGBB`). Statt
 * die Regel zu verbiegen, gibt es sie zweimal: einmal für `style`, einmal für
 * das Attribut. Geprüft wird beide Male dasselbe — genau sechs Hexziffern.
 */
export function hexZiffern(hex){
  const v = String(hex ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v : '';
}

/** Rückwärtskompatibler Alias (wurde früher in 03-parts.js definiert). */
export const escHtml = escJs;

// ── UTILS ──────────────────────────────────────────────
// ── Warum function statt const-Pfeilfunktion ────────────────────────────────
// Diese Helfer werden von anderen Modulen bei DEREN Top-Level-Auswertung
// benutzt (z. B. G('parts-search').addEventListener(…) in 03-parts.js). Bei
// gegenseitigen Importen wertet JavaScript das importierte Modul zuerst aus —
// eine `const`-Pfeilfunktion aus 01-core.js liegt dann noch in der temporalen
// Todeszone und wirft "G is not a function". Funktionsdeklarationen sind
// dagegen schon beim Instanziieren initialisiert und sofort erreichbar.
/**
 * Als Formularelement typisiert: Die meisten Aufrufe lesen .value, .checked
 * oder .disabled. Für ein anderes Element sind diese Felder schlicht leer —
 * die Typprüfung soll an den echten Fehlern hängen, nicht an jedem Feldzugriff.
 * @param {string} id
 * @returns {Feld}
 */
export function G(id) { return /** @type {Feld} */ (document.getElementById(id)); }
/**
 * querySelectorAll als HTMLElement[]: Die Oberfläche fragt nur HTML-Elemente
 * ab, und dataset, style und hidden gehören zu HTMLElement, nicht zu Element.
 * @param {string} sel @param {ParentNode} [wurzel]
 * @returns {HTMLElement[]}
 */
export function alle(sel, wurzel = document) { return /** @type {HTMLElement[]} */ ([...wurzel.querySelectorAll(sel)]); }
/** querySelector als HTMLElement, siehe alle(). @param {string} sel @param {ParentNode} [wurzel] */
export function eins(sel, wurzel = document) { return /** @type {HTMLElement | null} */ (wurzel.querySelector(sel)); }
/** Der offene Reiter (data-tab des aktiven Knopfs in der Leiste). */
export function aktiverReiter() { return eins('.ntab.active')?.dataset.tab; }
/** Ein Symbol aus der Symbolfamilie (Sprite in index.html) als HTML. */
export function ico(name) { return `<svg class="ico" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`; }
/**
 * Ein Vorschaubild aus einer Vorlage. Lädt es nicht, setzt 11-actions.js den
 * Platzhalter seiner Art (`ph`) an seine Stelle — dasselbe Bild wie für einen
 * Eintrag ganz ohne Bild, statt des Browser-Symbols für kaputte Bilder.
 * @param {{ src: string, alt: string, ph?: 'set'|'teil'|'figur', klasse?: string,
 *           orig?: string, stil?: string, fade?: boolean, extra?: string }} o
 */
export function bildTag(o) {
  return `<img src="${escUrl(o.src)}" alt="${esc(o.alt || '')}"${o.klasse ? ` class="${esc(o.klasse)}"` : ''}` +
    ` loading="lazy" decoding="async" data-onerror="platzhalter" data-ph="${esc(o.ph || 'set')}"` +
    `${o.orig ? ` data-orig="${escUrl(o.orig)}"` : ''}${o.fade ? ' data-fade="1"' : ''}` +
    `${o.stil ? ` data-stil="${esc(o.stil)}"` : ''}${o.extra ? ' ' + o.extra : ''} />`;
}

/** Der Platzhalter einer Art: das Set-Bild oder das Symbol in einer getönten Fläche. */
export function platzhalterInhalt(art) {
  // Dasselbe dezente Symbol wie bei Teilen und Figuren; das rote Logo füllte
  // ohne Bilder jede Karte gleich.
  // Sets nehmen die Datei: Sie sieht in jedem Design gleich aus (UI-Prüfung 6, M3).
  if (art === 'set') return '<img src="/assets/set-placeholder.svg" alt="" aria-hidden="true">';
  return ico(art === 'figur' ? 'figur' : 'teil');
}

/**
 * Zeigt den Platzhalter, solange ein Bild noch einmal versucht wird; das Bild
 * bleibt verborgen daneben und ersetzt ihn, sobald es doch lädt. Ohne das
 * stand während des zweiten Versuchs das Symbol des Browsers in der Kachel.
 */
export function bildVorlaeufig(img) {
  if (img.previousElementSibling?.classList.contains('bild-ph-vorlaeufig')) return;
  bildPlatzhalter(img, true);
  img.hidden = true; img.style.display = 'none';
  // Verborgen lädt ein lazy-Bild nie; der zweite Versuch soll aber laufen.
  img.setAttribute('loading', 'eager');
}

/** Das Bild hat doch geladen: vorläufigen Platzhalter entfernen. */
export function bildGeladen(img) {
  const ph = img.previousElementSibling;
  if (!ph?.classList.contains('bild-ph-vorlaeufig')) return;
  ph.remove(); img.hidden = false; img.style.display = '';
}

/** Ersetzt ein Bild, das nicht lädt, durch seinen Platzhalter in derselben Grösse. */
export function bildPlatzhalter(img, vorlaeufig = false) {
  const alt = img.previousElementSibling;
  if (!vorlaeufig && alt?.classList.contains('bild-ph-vorlaeufig')) { alt.classList.remove('bild-ph-vorlaeufig'); img.remove(); return; }
  const ph = document.createElement('span');
  ph.className = ('bild-ph ' + (img.getAttribute('class') || '').replace(/\bloaded\b/, '')).trim();
  ph.setAttribute('role', 'img');
  ph.setAttribute('aria-label', img.getAttribute('alt') || '');
  if (!img.getAttribute('alt')) ph.setAttribute('aria-hidden', 'true');
  const cs = getComputedStyle(img);
  // In der Kachel füllt der Platzhalter die Bildfläche; ein kaputtes Bild misst nur sein Symbol.
  if (!img.closest('.sci')) for (const k of ['width', 'height', 'borderRadius', 'margin']) if (cs[k] && cs[k] !== 'auto') ph.style[k] = cs[k];
  ph.innerHTML = platzhalterInhalt(img.dataset.ph);
  if (vorlaeufig) { ph.classList.add('bild-ph-vorlaeufig'); img.before(ph); return; }
  img.replaceWith(ph);
}

/**
 * Sieht die Eingabe aus wie eine Set-Nummer? Ziffern, davor höchstens ein
 * Buchstaben-Präfix echter Nummern (llca30, comcon001), dahinter ein
 * Versionsanhang (-1). Der Server prüft selbst; hier geht es darum, dass
 * „abc“ gar nicht erst als Set „abc-1“ angelegt wird.
 */
export function istSetnummer(eingabe) {
  return /^[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?$/.test(String(eingabe ?? '').trim());
}

/**
 * Eine Fehlermeldung direkt am Feld (leerer Text räumt sie weg). Vorleser
 * hören sie über role="alert" und finden sie über aria-describedby.
 */
export function feldFehler(id, text) {
  const feld = G(id);
  if (!feld) return;
  /** @type {HTMLElement | null} */
  let el = G(id + '-fehler');
  if (!el) {
    el = document.createElement('div');
    el.id = id + '-fehler';
    el.className = 'feld-fehler';
    el.setAttribute('role', 'alert');
    feld.insertAdjacentElement('afterend', el);
    feld.addEventListener('input', () => feldFehler(id, ''));
  }
  el.textContent = text || '';
  el.hidden = !text;
  if (text) {
    feld.setAttribute('aria-invalid', 'true');
    feld.setAttribute('aria-describedby', el.id);
    feld.focus();
  } else {
    feld.removeAttribute('aria-invalid');
    feld.removeAttribute('aria-describedby');
  }
}

/**
 * Eine Absage des Servers: Gehört ihr Code zu einem Feld des Formulars, steht
 * die Meldung dort (wie feldFehler), sonst als Toast.
 * @param {any} d Antwort von api()
 * @param {Record<string, string>} felder Fehlercode → Feld-ID
 * @param {string} ersatz Text, wenn die Antwort keinen hat
 */
export function antwortFehler(d, felder, ersatz) {
  const id = d?.code ? felder[d.code] : null;
  if (id && G(id)) feldFehler(id, d.error || ersatz);
  else toast(d?.error || ersatz, 'error');
}

/** Prüft das Set-Nummer-Feld vor dem Absenden; meldet am Feld und sagt, ob es weitergeht. */
export function setnummerFeldGueltig(id, wert) {
  const v = wert ?? (G(id)?.value || '').trim();
  if (!v) { feldFehler(id, tRaw('common.enter_set_number')); return false; }
  if (!istSetnummer(v)) { feldFehler(id, tRaw('gallery.add.number_invalid', { num: v })); return false; }
  feldFehler(id, '');
  return true;
}

/**
 * Ein leerer Zustand: Symbol, ein Satz, und wenn es einen gibt, der nächste
 * Schritt als Knopf. Texte kommen fertig übersetzt; maskiert wird hier.
 * @param {{ ico: string, titel: string, text?: string, knopf?: { text: string, click: string, arg?: string, ico?: string, art?: string } }} o
 */
export function leerZustand(o) {
  const knopf = o.knopf ? `<button type="button" class="btn ${o.knopf.art || 'bp'}" data-click="${esc(o.knopf.click)}"${o.knopf.arg ? ` data-arg="${esc(o.knopf.arg)}"` : ''}>${ico(o.knopf.ico || 'plus')}<span>${esc(o.knopf.text)}</span></button>` : '';
  return `<div class="empty leer"><div class="leer-ico">${ico(o.ico)}</div><h2>${esc(o.titel)}</h2>${o.text ? `<p>${esc(o.text)}</p>` : ''}${knopf}</div>`;
}

/** Der Knopf „Filter zurücksetzen“ für einen Leerzustand ohne Treffer. */
export function zuruecksetzenKnopf(ansicht) {
  return { text: tRaw('common.reset_filter'), click: 'filterZuruecksetzen', arg: ansicht, ico: 'schliessen', art: 'bs' };
}

/**
 * Einen Knopf für die Dauer eines Aufrufs sperren.
 *
 * ── Der Befund ───────────────────────────────────────────────
 *
 * Fünf Stellen taten dasselbe: sperren, „läuft"-Text setzen, danach freigeben
 * und die Beschriftung ZURÜCKSCHREIBEN. Und alle fünf schrieben sie als
 * deutsches Literal zurück:
 *
 *     btn.textContent = 'Registrieren'    // im HTML: data-i18n="register.submit"
 *
 * Zwei Folgen, beide unbemerkt: In einer englischen Oberfläche stand nach dem
 * ersten Klick ein deutsches Wort auf dem Knopf. Und das Literal stimmte nicht
 * einmal mit dem Wörterbuch überein — `register.submit` heisst „Konto
 * erstellen", nicht „Registrieren"; der Knopf beschriftete sich also selbst
 * bei deutscher Oberfläche um.
 *
 * Die Beschriftung wird deshalb nicht mehr NEU GESETZT, sondern GEMERKT. Damit
 * gibt es keine zweite Fassung, die auseinanderlaufen kann — und der Helfer
 * braucht keine Sprache zu kennen.
 *
 * Die BESCHRIFTUNG BLEIBT STEHEN. Frueher tauschte der Helfer sie gegen
 * Auslassungspunkte; Marco am 22.09.: „Wenn ich Bereits vorhandene Teile
 * eintragen klicke verschwindet der Button nach wie vor kurz und man sieht
 * ganz kurz Punkt." Genau das war es — der Knopf sah fuer zwei
 * Zehntelsekunden leer aus. Dass er arbeitet, zeigen jetzt drei Dinge, die
 * die Breite nicht anfassen: Er ist gesperrt (.btn:disabled blendet ihn ab),
 * der Zeiger wird zu „progress", und ueber die Unterkante laeuft ein
 * schmaler Streifen (.besetzt in styles.css). Die App macht es seit demselben
 * Tag genauso — dort wird nur das Symbol zum Kreisel, die Beschriftung bleibt
 * (PartsListScreen.kt).
 *
 * Sprachfrei bleibt es damit erst recht: Es kommt gar kein Wort hinzu.
 *
 * @param {HTMLButtonElement | HTMLInputElement} btn
 * @param {string} [laeuft] Andere Beschriftung waehrend der Arbeit. NUR
 *   angeben, wenn der Knopf wirklich etwas anderes sagen soll: Die
 *   PDF-Erzeugung tut das, weil sie den Fortschritt hineinschreibt
 *   (erstellen → Bilder → Restzeit). Ohne dieses Argument bleibt die
 *   Beschriftung unangetastet.
 * @returns {(text?: string) => void} Freigabe. Ohne Argument kommt die
 *   urspruengliche Beschriftung zurueck; mit Argument eine andere — die
 *   QR-Erzeugung heisst danach absichtlich „Neu generieren".
 */
export function knopfBesetzt(btn, laeuft) {
  const vorher = btn.textContent;
  // Die Breite einfrieren, BEVOR sich etwas aendern kann.
  //
  // Ohne das riss der Knopf die ganze Zeile mit: Auslassungspunkte sind rund
  // 200 px schmaler als „Bereits vorhandene Teile eintragen", und in einer
  // flex-Zeile rutscht dann alles rechts daneben nach. Gemessen an Marcos
  // Video vom 22.09.: sieben Bilder bei 30 B/s, gut 0,2 s.
  //
  // Seit die Beschriftung stehen bleibt, greift das nur noch im Fall mit
  // eigenem Wartetext. Es steht trotzdem hier und nicht dort, weil die Regel
  // fuer BEIDE Wege dieselbe ist.
  //
  // offsetWidth ist die Aussenbreite inklusive Rahmen und Innenabstand; 0
  // heisst „wird gerade nicht angezeigt" (display:none, oder jsdom ohne
  // Layout) — da gibt es nichts einzufrieren.
  const breite = btn.offsetWidth;
  const minVorher = btn.style.minWidth;
  if (breite) btn.style.minWidth = breite + 'px';
  btn.disabled = true;
  btn.classList.add('besetzt');
  if (laeuft !== undefined) btn.textContent = laeuft;
  return (text) => {
    btn.disabled = false;
    btn.classList.remove('besetzt');
    // Nur zuruecksetzen, was ueberhaupt gesetzt wurde — sonst schriebe die
    // Freigabe eine Beschriftung neu, die nie weg war.
    if (text !== undefined) btn.textContent = text;
    else if (laeuft !== undefined) btn.textContent = vorher;
    // Die eigene Vorgabe zurueckgeben, nicht blind leeren: Ein Knopf, der von
    // sich aus eine min-width traegt, behaelt sie.
    btn.style.minWidth = minVorher;
  };
}

// Return thumbnail URL if it would exist, else original
/**
 * @param {string} src
 * @param {boolean} [thumb] Verkleinerte Fassung anfordern. Wirkt nur für
 *        Bilder, die über /api/img-proxy laufen (Rebrickable-CDN) — für
 *        lokale Dateien entscheidet ausschliesslich der Server (image_local
 *        ist bereits die richtige Adresse, siehe thumbUrl()).
 */
/**
 * Die Adresse des Bild-Proxys — und die alte daneben.
 *
 * Der Proxy ist mit der API-Zusammenlegung nach /api/v1 gezogen. Die alte
 * Schreibweise muss der Browser trotzdem ERKENNEN: `image_url` kommt aus der
 * Datenbank, und ein Abbild, das aelter ist als die Migration, traegt sie
 * noch. GEBAUT wird nur die neue.
 *
 * Die Begruendung in ganzer Laenge steht serverseitig bei den gleichnamigen
 * Konstanten in src/katalog/bilder/images.ts.
 */
const IMG_PROXY = '/api/v1/img-proxy';
const IMG_PROXY_ALT = '/api/img-proxy';
/** Traegt diese Adresse eine der beiden Proxy-Formen? */
function istProxyPfad(src) {
  return src.startsWith(IMG_PROXY) || src.startsWith(IMG_PROXY_ALT);
}

/**
 * Adressen auf den EIGENEN Server auf ihren Pfad zurückführen.
 *
 * ── Warum das nötig ist ─────────────────────────────────────────────────────
 * `imgEl.src` liefert nicht den Attributwert, sondern die vom Browser
 * AUFGELÖSTE absolute Adresse: Aus src="/images/sets/9396-1.jpg" wird
 * "https://<server>/images/sets/9396-1.jpg". Genau diesen Wert reicht der Zoom
 * weiter (11-actions.js, openImageLightboxFromEl greift auf this.src zurück,
 * wenn data-orig nur den Platzhalter trägt).
 *
 * Seit imgUrl()/fullUrl() JEDE absolute Adresse über /api/img-proxy leiten,
 * landete damit die eigene Server-Adresse im url=-Parameter — und der Proxy
 * lehnte sie mit 403 ab, völlig zu Recht: Seine Allowlist kennt nur die
 * Bild-CDNs, und ein Proxy, der auf sich selbst zeigt, wäre eine offene
 * Weiterleitung.
 *
 * Die Kacheln waren nicht betroffen, weil sie ihre Adressen aus den Vorlagen
 * beziehen (relativ) statt aus der IDL-Eigenschaft — deshalb fiel es nur beim
 * Zoom auf.
 *
 * @param {string} src
 * @returns {string} Pfad, wenn die Adresse auf den eigenen Ursprung zeigt, sonst unverändert
 */
function stripOwnOrigin(src) {
  if (typeof location === 'undefined' || !location.origin) return src;
  if (src.startsWith(location.origin + '/')) return src.slice(location.origin.length);
  return src;
}

export function imgUrl(src, thumb) {
  if (!src) return '';
  src = stripOwnOrigin(src);

  // Bereits eine Server-Adresse (lokale Datei oder Proxy) — unverändert lassen.
  //
  // VORHER stand hier ein "Entpacken": Zeigte eine Proxy-Adresse auf einen
  // Host, der NICHT rebrickable.com war (Brickset, BrickLink), wurde die
  // eingebettete Adresse ausgepackt und direkt geladen — also am Backend
  // vorbei. Ebenso fiel jede absolute Adresse, die nicht mit
  // cdn.rebrickable.com begann, am Ende der Funktion unverändert durch.
  //
  // Beides ist entfallen: Der Browser spricht ausschliesslich mit dem eigenen
  // Server. Das ist nicht nur Konsistenz — der Proxy setzt die Kopfzeilen
  // gegen Cloudflares Hotlink-Schutz, entpackt komprimierte Antworten, hält
  // einen Plattencache und einen Negativ-Cache. Nichts davon wirkt, wenn der
  // Browser die Adresse selbst aufruft.
  if (src.startsWith('/data/') || src.startsWith('/images/') || istProxyPfad(src)) {
    return src;
  }
  // Sonstige relative Pfade (z. B. /assets/…) unverändert.
  if (src.startsWith('/')) return src;

  // Alles Absolute geht über den Proxy — unabhängig vom Host. Welche Hosts
  // zulässig sind, entscheidet ausschliesslich der Server
  // (isAllowedImageHost in routes/imgProxy.ts); ein zweiter, abweichender
  // Allowlist-Test im Client wäre nur eine weitere Stelle, die man vergisst
  // mitzupflegen.
  if (/^https?:\/\//.test(src)) {
    // Teilebilder haben auf dem CDN keine _thumb-Variante; die Verkleinerung
    // entsteht serverseitig aus dem Proxy-Cache (siehe routes/imgProxy.ts).
    // `thumb` kennt drei Werte:
    //   false  — volle Auflösung
    //   true   — Vorschau; fehlt sie, wird sie erzeugt
    //   'nur'  — Vorschau NUTZEN, aber keine erzeugen (Marcos Frage:
    //            „Der Proxy sollte das Bild in Originalgrösse weitergeben und
    //            die Thumbs mit einem Job nachladen")
    //
    // Der dritte Wert ist für den KATALOG. Er zeigt rund 25 000 fremde Sets;
    // für jedes eine Verkleinerung zu rechnen ist Arbeit, die niemand je
    // wieder braucht — man scrollt vorbei. Der eigene Bestand (Galerie, Teile,
    // Minifiguren) bleibt bei `true`: Das sind ein paar hundert Bilder, die man
    // täglich wiedersieht, und dort lohnt die Verkleinerung.
    const tp = thumb === 'nur' ? '&thumb=1&gen=0' : (thumb ? '&thumb=1' : '');
    return IMG_PROXY + '?url=' + encodeURIComponent(src) + tp;
  }
  return src;
}
/**
 * Gegenstück zu thumbUrl(): liefert die volle Auflösung.
 *
 * Nötig, weil manche Sets image_local direkt auf die _thumb-Datei zeigen
 * (der Server kann das so abgelegt haben) — und weil Detailansicht und Zoom
 * die grosse Fassung zeigen sollen, nicht die Kachelgrösse.
 */
export function fullUrl(src) {
  if (!src) return src;
  src = stripOwnOrigin(src);
  if (istProxyPfad(src)) return src.replace(/&thumb=1\b/, '').replace(/&gen=0\b/, '');
  // Absolute Adresse (CDN) auch hier über den Proxy — vorher wurde sie
  // unverändert zurückgegeben, sodass Detailansicht und Zoom direkt beim CDN
  // luden. Siehe die Begründung in imgUrl().
  if (/^https?:\/\//.test(src)) return IMG_PROXY + '?url=' + encodeURIComponent(src);
  return src.replace(/_thumb(\.[^.?]+)(\?|$)/, '$1$2');
}

/**
 * Wert für ein HTML-Attribut absichern. Wird für die Datenattribute des
 * Log-Fensters gebraucht: Token, Basis-URL und die Übersetzungen als JSON.
 */
/**
 * Symbol für die BrickLink-Wanted-Listen-Knöpfe: ein XML-Dokument.
 *
 * ── Warum dieses Bild (Marcos Wunsch vom 20.10.) ────────────────────────────
 *
 * „Kannst du das Icon der Bricklink xml-Buttons ersetzen durch ein sprechendes
 *  Icon für Bricklink oder xml?"
 *
 * Dort stand ein Ziegelstein (🧱) — dasselbe Zeichen, das in diesem Baum für
 * Teile, Sets und die Marke steht; es sagte über diesen Knopf nichts.
 *
 * Gezeichnet ist jetzt, was der Knopf TUT: eine Datei mit Eselsohr und den
 * spitzen Klammern `<` `>` darin. Das ist das übliche Bild für eine
 * XML-Datei und braucht keine Erklärung.
 *
 * BEWUSST NICHT das BrickLink-Logo: Es ist eine fremde Marke. Dass die Liste
 * von dort kommt, sagt die Beschriftung daneben („BL-XML") und der Titel des
 * Knopfes — ein nachgezeichnetes Logo wäre eine Anmassung, die dieser Baum
 * nirgends sonst begeht.
 *
 * Form und Bauart wie beim Papierkorb darunter: 24er-Raster, `currentColor`,
 * `aria-hidden` (die Beschriftung steht daneben, das Symbol ist Zierde).
 */
export const XML_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" '
  + 'data-stil="width:1.05em;height:1.05em;display:inline-block;vertical-align:-.18em" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
  + 'stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'
  + '<path d="M14 3v5h5"/>'
  + '<path d="M10 12.5 8 14.5l2 2"/><path d="M14 12.5l2 2-2 2"/></svg>';

/**
 * Papierkorb-Symbol für Löschknöpfe auf Kacheln und in Listenzeilen.
 *
 * `currentColor` statt fester Farbe: Der Knopf bestimmt die Farbe über sein
 * CSS (weiss auf rotem Grund bei .delbtn, rot auf hellem Grund bei .bd), das
 * Symbol übernimmt sie. So passt es in beide Umgebungen ohne zweite Fassung.
 */
export const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" '
  + 'data-stil="width:1em;height:1em;display:block" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>'
  + '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
  + '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';

export function escHtmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Bildadresse für eine lokale Datei — unverändert, wie vom Server geliefert.
 *
 * Vorher konstruierte diese Funktion aus JEDEM lokalen Pfad selbst eine
 * "_thumb.jpg"-Variante, unabhängig davon, ob diese Datei existiert.
 * `src/katalog/bilder/images.ts` (Server, resolveImageLocal()) prüft das aber bereits: Es
 * liefert für `image_local` je nachdem den Thumb- ODER den Original-Pfad,
 * mit eigenem Existenz-Cache. Lieferte der Server den Original-Pfad, weil
 * die Vorschau (noch) fehlt, baute diese Funktion TROTZDEM ihre eigene
 * "_thumb.jpg"-Adresse daraus — denselben Pfad, von dem der Server soeben
 * festgestellt hatte, dass es ihn nicht gibt. Das führte zu Bildern, die
 * auch nach einem vollständigen Neuladen der Seite nicht erschienen: Der
 * Fehler lag nicht an fehlender Zeit, sondern daran, dass der Client die
 * bereits richtige Antwort des Servers verwarf und erneut die falsche
 * Adresse selbst zusammenbaute.
 *
 * Dieselbe Ursache und derselbe Fix wie in der Android-App
 * (util/ImageUrls.kt, resolveThumbUrl() — dort wurde toThumbPath()
 * vollständig entfernt). Für lokale Dateien gibt es jetzt an keiner Stelle
 * mehr einen client-seitigen Rateversuch — beide Clients laden Bilder
 * identisch.
 *
 * CDN-Adressen (über /api/img-proxy) sind davon nicht betroffen: Dort
 * entscheidet weiterhin der Aufrufer per &thumb=1, ob eine Vorschau
 * angefordert wird — der Proxy-Cache kennt keine serverseitige
 * Vorab-Entscheidung wie image_local, das Vorschaubild entsteht bei Bedarf.
 */
export function thumbUrl(src) {
  return src;
}

// Lazy image loading with IntersectionObserver and fade-in
/**
 * Blendet Bilder erst beim Sichtbarwerden ein — und markiert alles, was schon
 * fertig geladen ist, SOFORT als geladen.
 *
 * Der zweite Teil behebt das Flackern beim Neuaufbau einer Liste. styles.css
 * blendet Lazy-Bilder ein:
 *
 *     img[loading=lazy]        { opacity:0; transition:opacity .25s ease }
 *     img[loading=lazy].loaded { opacity:1 }
 *
 * Wird eine Liste per innerHTML neu gebaut, sind alle <img> neue Elemente und
 * starten wieder bei opacity:0 — auch wenn das Bild längst im Browser-Cache
 * liegt. Die .loaded-Klasse kam bisher ausschliesslich aus dem
 * IntersectionObserver-Callback, und das ist asynchron: Zwischen innerHTML und
 * Callback liegt mindestens ein Paint mit unsichtbaren Bildern. Genau das ist
 * die kurz weisse Kachelwand, wenn enrichGalleryWithPrices() die Galerie ein
 * zweites Mal rendert.
 *
 * complete && naturalWidth > 0 heisst "steht sofort zur Verfügung" — solche
 * Bilder brauchen weder Beobachtung noch Einblendung.
 */
export function observeLazyImages(root) {
  const imgs = (root||document).querySelectorAll('img[loading=lazy]:not(.observed)');
  if(!imgs.length) return;
  // Synchron, VOR dem nächsten Paint
  imgs.forEach(img => { if(img.complete && img.naturalWidth > 0) img.classList.add('loaded'); });
  if(!window._imgObserver){
    window._imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if(e.isIntersecting){
          const img = /** @type {HTMLImageElement} */ (e.target);
          if(img.complete) img.classList.add('loaded');
          img.addEventListener('load', ()=>img.classList.add('loaded'), {once:true});
          window._imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });
  }
  imgs.forEach(img => { img.classList.add('observed'); window._imgObserver.observe(img); });
}
/** Anzeigedauer je Art in ms. */
const TOAST_DAUER = { success: 3500, info: 5000, error: 9000 };
/** @type {WeakMap<Element, {schluessel: string, anzahl: number, frist: any}>} */
const _toastStand = new WeakMap();
/** @param {{text: string, fn: () => any}} [aktion] Knopf in der Meldung, z. B. „Rückgängig" */
export function toast(msg, type='info', aktion) {
  const c = G('toasts');
  // Dieselbe Meldung noch einmal: zählen statt stapeln, und die Frist beginnt neu.
  const schluessel = `${type}|${String(msg ?? '')}`;
  const gleich = aktion ? null : [...c.children].find(x => _toastStand.get(x)?.schluessel === schluessel);
  if (gleich) {
    const stand = _toastStand.get(gleich);
    stand.anzahl++;
    const zahl = /** @type {HTMLElement} */ (gleich.querySelector('.toast-anzahl'));
    zahl.textContent = `×${stand.anzahl}`; zahl.hidden = false;
    clearTimeout(stand.frist);
    stand.frist = setTimeout(() => gleich.remove(), TOAST_DAUER[type] ?? 4500);
    return /** @type {HTMLElement} */ (gleich);
  }
  const el = document.createElement('div');
  el.className=`toast ${type}`;
  if (type === 'error') el.setAttribute('role', 'alert');
  // textContent statt innerHTML: msg enthält regelmässig Server-Fehlermeldungen
  // und Set-/Teilenummern aus Nutzereingaben.
  const icon = document.createElement('span');
  icon.className = 'toast-ico';
  icon.innerHTML = ico({ success: 'ok', error: 'fehler' }[type] || 'info');
  const text = document.createElement('span');
  text.textContent = String(msg ?? '');
  const anzahl = document.createElement('span');
  anzahl.className = 'toast-anzahl'; anzahl.hidden = true;
  el.append(icon, text, anzahl);
  if (aktion) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'toast-aktion';
    knopf.textContent = aktion.text;
    knopf.onclick = () => { el.remove(); aktion.fn(); };
    el.append(knopf);
  }
  // Ein Fehler will gelesen werden, eine Bestätigung nur gesehen; mit Knopf
  // muss man ihn auch treffen. Ein Klick auf die Meldung räumt sie weg, damit
  // sie keine Karte verdeckt.
  el.addEventListener('click', e => { if (e.target === el || !(/** @type {Element} */ (e.target)).closest('button')) el.remove(); });
  c.appendChild(el);
  _toastStand.set(el, { schluessel, anzahl: 1, frist: setTimeout(() => el.remove(), Math.max(aktion ? 9000 : 0, TOAST_DAUER[type] ?? 4500)) });
  return el;
}
/**
 * Beim Wechsel der Ansicht: Meldungen gehören zu der Ansicht, in der sie
 * entstanden; nur solche mit Knopf (Rückgängig, Ändern) bleiben bis zur Frist.
 */
export function verwirfToasts() {
  for (const el of [...(G('toasts')?.children || [])]) if (!el.querySelector('.toast-aktion')) el.remove();
}
/**
 * Jeder Weg zur eigenen API läuft hierüber: Sprache, Verbindungsband und das
 * Ende der Sitzung (401) gelten dann auch für Uploads, Downloads und Ströme.
 * Wirft nur bei Netzfehler oder Abbruch; den Status prüft der Aufrufer.
 * @param {string} method
 * @param {string} path  ohne `/api`, z. B. `/v1/sets`
 * @param {{ body?: FormData | object | null, signal?: AbortSignal, headers?: Record<string, string>, cache?: RequestCache }} [o]
 * @returns {Promise<Response>}
 */
export async function apiRoh(method, path, o = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Accept-Language': LANG, ...o.headers };
  /** @type {RequestInit} */
  const init = { method, headers, credentials: 'same-origin' };
  if (o.body instanceof FormData) init.body = o.body;
  else if (o.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
  if (o.signal) init.signal = o.signal;
  if (o.cache) init.cache = o.cache;
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch (e) {
    if (/** @type {any} */ (e)?.name !== 'AbortError') { console.warn('[api]', method, path, e); zeigeVerbindung(false); }
    throw e;
  }
  _letzteAntwort = new Date();
  zeigeVerbindung(true);
  if (res.status === 401) melde('sitzungBeendet', path);
  return res;
}

/**
 * Aufruf der eigenen API mit JSON-Antwort. Liefert IMMER ein Objekt, nie eine
 * Ausnahme: Jeder Fehlschlag (Netz, HTML-Fehlerseite des Proxys, Status ohne
 * `success`) kommt als `{ success: false, error }` zurück, wie vom Server.
 * `status` und `networkError` sind für die Stellen, die genauer unterscheiden.
 * Ein FormData-Körper geht als Upload, jeder andere als JSON.
 * @param {string} method
 * @param {string} path
 * @param {FormData | object | null} [body]
 * @param {{ signal?: AbortSignal, cache?: RequestCache }} [o]
 * @returns {Promise<any>}
 */
export async function api(method, path, body, o = {}) {
  let res;
  try {
    res = await apiRoh(method, path, { ...o, body: body ?? null });
  } catch (_) {
    return { success:false, error:tRaw('api.unreachable'), networkError:true, status:0 };
  }
  let daten = null;
  try {
    daten = await res.json();
  } catch (_) {
    console.warn('[api]', method, path, 'Antwort ist kein JSON (Status ' + res.status + ')');
    return { success:false, status:res.status,
             error: res.ok ? tRaw('api.unexpected') : tRaw('api.server_error', { status:res.status }) };
  }
  if (!res.ok && daten && typeof daten === 'object' && daten.success === undefined) {
    return { ...daten, success:false, status:res.status,
             error: daten.error || tRaw('api.server_error', { status:res.status }) };
  }
  if (daten && typeof daten === 'object') daten.status = res.status;
  if (res.status === 403 && daten?.code === 'passwort_wechsel_noetig') melde('passwortWechselNoetig');
  return daten;
}

/**
 * Meldetext für eine Ausnahme aus fetch(). Der Browser sagt „Failed to
 * fetch“ oder „NetworkError…“; der Nutzer soll lesen, was es heisst.
 * @param {unknown} e
 */
export function fehlerMeldung(e) {
  const text = String(/** @type {any} */ (e)?.message ?? e ?? '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text) || (typeof navigator !== 'undefined' && navigator.onLine === false))
    return tRaw('api.unreachable');
  return text || tRaw('common.unknown_error');
}

// ── Hinweis „Rebrickable-Schlüssel fehlt“ ───────────────────────────────────
const RB_HINWEIS_WEG = 'bim_rb_hinweis_weg';
/** Weggeklickt bleibt das Band 30 Tage weg, auch über Neustarts: Bei 200 %
 * Zoom kostet es ein Achtel der Höhe; erinnert wird später trotzdem. */
const RB_HINWEIS_FRIST = 30 * 24 * 3600 * 1000;
/** Über dem Einrichtungsassistenten nicht: Der fragt genau diesen Schlüssel ab.
 * Schliesst man ihn mit „Später“, kommt das Band (22-einrichtung.js). */
export function rbHinweisZeigen() {
  const band = G('rb-hinweis');
  if (!band || !ME?.isAdmin || G('einrichtung-modal')?.classList.contains('open')) return;
  if (String(_settingsCache?.rebrickable_api_key || '').trim()) return;
  try {
    const weg = Number(localStorage.getItem(RB_HINWEIS_WEG));
    if (weg && Date.now() - weg < RB_HINWEIS_FRIST) return;
  } catch (_) { /* ohne Speicher: zeigen */ }
  band.hidden = false;
}
export function rbHinweisVerbergen() { const b = G('rb-hinweis'); if (b) b.hidden = true; }
function rbHinweisOeffnen() {
  rbHinweisVerbergen();
  eins('.ntab[data-tab="settings"]')?.click();
  /** @type {HTMLElement|null} */ (document.querySelector('.einst-nav a[data-arg="einst-rb"]'))?.click();
  G('rb-key')?.focus();
}
/** Wegklicken gilt RB_HINWEIS_FRIST lang; der Fokus geht an den Seiteninhalt statt ins Leere. */
function rbHinweisWeg() {
  rbHinweisVerbergen();
  try { localStorage.setItem(RB_HINWEIS_WEG, String(Date.now())); } catch (_) { /* dann eben bis zum Neuladen */ }
  G('inhalt')?.focus({ preventScroll: true });
}

// ── Verbindung ──────────────────────────────────────────────────────────────
// Ohne Netz zeigt die Seite weiter den letzten Stand. Das Band sagt, dass es
// einer ist und von wann — sonst hält man alte Zahlen für aktuell.
let _letzteAntwort = null;
let _offline = false;
/** @param {boolean} erreichbar */
export function zeigeVerbindung(erreichbar) {
  if (erreichbar && typeof navigator !== 'undefined' && navigator.onLine === false) erreichbar = false;
  const band = typeof document !== 'undefined' ? document.getElementById('offline-band') : null;
  if (!band) return;
  if (erreichbar) {
    if (_offline) toast(tRaw('net.back'), 'success');
    if (_offline) schreibenSperren(false);
    _offline = false; band.hidden = true; return;
  }
  _offline = true;
  band.textContent = (_letzteAntwort ? tRaw('net.offline_since', { zeit: fmtDatum(_letzteAntwort, 'tagzeit') }) : tRaw('net.offline'))
    + ' ' + tRaw('net.offline_gesperrt');
  band.hidden = false;
  schreibenSperren(true);
}

// Ohne Verbindung scheitert jede Änderung. Statt erst nach dem Klick eine
// Meldung zu zeigen, sind die schreibenden Bedienelemente gesperrt und nennen
// per aria-describedby das Band als Grund. Eine Regel statt einer Liste:
// Hauptknöpfe, Datei-Wahl, Import-Menüs und jede Handlung, deren Name schreibt.
const BEDIENT = 'button, input[type=file], .import-menue > summary';
const IMMER_SCHREIBEND = 'button.bp, button.bd, input[type=file], .import-menue > summary';
const SCHREIB_VERBEN = /speicher|save|loesch|delete|import|hinzufueg|add|anleg|erfass|uebernehm|eintrag|abfrag|aktualis|refresh|sync|hochlad|upload|rotier|widerruf|einlad|verknuepf|aendere|bearbeit|entfern|wiederherst|restore|generier|erzeug|verschieb|qty|menge|alarm/i;
const NICHT_SPERREN = '#login-screen, .toast, [data-dialog-zu], .hinweis-zu';
/** @param {Element} k */
function schreibt(k) {
  if (k.closest(NICHT_SPERREN)) return false;
  if (k.matches(IMMER_SCHREIBEND)) return true;
  return SCHREIB_VERBEN.test(`${k.getAttribute('data-click') || ''} ${k.getAttribute('data-submit') || ''}`);
}
/** @type {MutationObserver|null} */
let _sperrBeobachter = null;
/** @param {Element|Document} wurzel */
function sperreIn(wurzel) {
  const selbst = wurzel instanceof Element && wurzel.matches(BEDIENT) ? [wurzel] : [];
  /** @type {HTMLButtonElement[]} */ ([...selbst, ...wurzel.querySelectorAll(BEDIENT)]).forEach(k => {
    if (k.disabled || k.dataset.offlineGesperrt || !schreibt(k)) return;
    if (k.tagName === 'SUMMARY') { k.setAttribute('aria-disabled', 'true'); k.parentElement?.removeAttribute('open'); }
    else k.disabled = true;
    k.dataset.offlineGesperrt = '1';
    k.setAttribute('aria-describedby', ((k.getAttribute('aria-describedby') || '') + ' offline-band').trim());
  });
}
// Ein <summary> kennt kein disabled: Klick und Tastatur öffnen es sonst trotzdem.
if (typeof document !== 'undefined')
  document.addEventListener('click', e => {
    const t = /** @type {Element} */ (e.target);
    if (t?.closest?.('summary[data-offline-gesperrt]')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
/** @param {boolean} an */
function schreibenSperren(an) {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-offline', an);
  if (an) {
    sperreIn(document);
    if (!_sperrBeobachter && typeof MutationObserver !== 'undefined') {
      _sperrBeobachter = new MutationObserver(m => { for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1) sperreIn(/** @type {Element} */ (n)); });
      _sperrBeobachter.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  _sperrBeobachter?.disconnect(); _sperrBeobachter = null;
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-offline-gesperrt]')).forEach(k => {
    if (k.tagName === 'SUMMARY') k.removeAttribute('aria-disabled'); else k.disabled = false;
    delete k.dataset.offlineGesperrt;
    const rest = (k.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== 'offline-band');
    if (rest.length) k.setAttribute('aria-describedby', rest.join(' ')); else k.removeAttribute('aria-describedby');
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => zeigeVerbindung(false));
  window.addEventListener('online', () => zeigeVerbindung(true));
}

/**
 * Ein GELDBETRAG in der Waehrung des Nutzers.
 *
 * ── Warum der Rueckfall nicht mehr 'EUR' ist ─────────────────
 *
 * Hier stand `cur||'EUR'`. Wer das zweite Argument vergisst, bekam damit still
 * Euro — und zwar auch dann, wenn der Nutzer in Franken rechnet. Genau das ist
 * im Teile-Detail passiert: Zwei Aufrufe uebergaben gar keine Waehrung, weil
 * sie ueberhaupt keinen Betrag formatieren wollten, sondern eine ANZAHL.
 * Angezeigt wurde „EUR 6.00×" statt „6×".
 *
 * Die Anzahlen sind umgestellt (13-acquisition-modals.js). Der Rueckfall hier
 * bleibt trotzdem falsch: Ein vergessenes Argument soll wenigstens die
 * eingestellte Waehrung nehmen, nicht eine fest verdrahtete. `CURRENCY` traegt
 * sie; 'EUR' steht nur noch als letzte Stufe da, falls die Einstellung noch
 * nicht geladen ist.
 *
 * Dass ueberhaupt kein Aufruf das Argument weglaesst, haelt
 * test/geldformat.test.js fest — dort steht auch, warum das die eigentliche
 * Regel ist.
 */
export function fmtN(v,cur){
  if(!v||v==0) return '—';
  return new Intl.NumberFormat(locale(),{style:'currency',currency:cur||CURRENCY||'EUR',minimumFractionDigits:2}).format(v);
}
/** Ein erfasster Kaufpreis von 0 ist ein Geschenk; fehlt er (null), ist er unbekannt. */
export function istGeschenk(kauf){
  return kauf !== null && kauf !== undefined && String(kauf).trim() !== '' && Number(kauf) === 0;
}
/** Betrag, bei dem 0 ein Wert ist (Kaufpreis): „0,00 €“ statt „—“. */
export function fmtGeld(v, cur){
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '—';
  return Number(v) === 0 ? new Intl.NumberFormat(locale(),{style:'currency',currency:cur||CURRENCY||'EUR',minimumFractionDigits:2}).format(0) : fmtN(v, cur);
}
/**
 * Ein Betrag aus einem Eingabefeld. Komma und Punkt sind beide Dezimalzeichen,
 * Leerzeichen und ' sind Tausendertrenner; ein einzelnes Trennzeichen mit genau
 * drei Ziffern danach gilt als Tausender, wenn die Sprache es so schreibt
 * („1.234“ de-DE). Leer → null; keine Zahl → NaN, damit der Aufrufer am Feld
 * meldet, statt „149,95“ still zu 149 zu kürzen.
 * @param {unknown} roh
 * @returns {number|null}
 */
export function leseBetrag(roh) {
  const s = String(roh ?? '').replace(/[\s  '’]/g, '').replace(/^[€$£]|[€$£]$/g, '');
  if (!s) return null;
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return NaN;
  const trenner = s.match(/[.,]/g) || [];
  const letztes = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let dezimal = trenner.length ? s[letztes] : null;
  if (new Set(trenner).size === 1 && trenner.length > 1) dezimal = null;
  if (trenner.length === 1) {
    const gruppe = new Intl.NumberFormat(locale()).formatToParts(1000).find(p => p.type === 'group')?.value;
    if (trenner[0] === gruppe && /^\d{3}$/.test(s.slice(letztes + 1)) && !/^0[.,]/.test(s)) dezimal = null;
  }
  const ganz = dezimal ? s.slice(0, letztes) : s, nach = dezimal ? s.slice(letztes + 1) : '';
  if (/[.,]/.test(nach) || (dezimal && ganz.includes(dezimal))) return NaN;
  const gruppen = ganz.split(/[.,]/);
  if (gruppen.length > 1 && (!/^\d{1,3}$/.test(gruppen[0]) || gruppen.slice(1).some(g => !/^\d{3}$/.test(g)))) return NaN;
  return Number((gruppen.join('') || '0') + (nach ? '.' + nach : ''));
}

/** Ein Betrag für ein Eingabefeld in der Schreibweise der Sprache („129,99“ de-DE), ohne Tausender. */
export function betragFuerFeld(v) {
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '';
  return new Intl.NumberFormat(locale(), { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v));
}

/**
 * Liest ein Geldfeld; ist der Inhalt keine Zahl (oder negativ), steht die
 * Meldung am Feld und `ok` ist false — gesendet wird dann nichts.
 * @param {string|HTMLInputElement} feld  ID oder Element
 * @returns {{ ok: boolean, wert: number|null }}
 */
export function betragAusFeld(feld) {
  const el = typeof feld === 'string' ? G(feld) : feld;
  if (!el) return { ok: true, wert: null };
  const wert = leseBetrag(el.value);
  if (wert !== null && !(wert >= 0)) {
    if (el.id) feldFehler(el.id, tRaw('common.amount_invalid', { wert: el.value.trim() }));
    else toast(tRaw('common.amount_invalid', { wert: el.value.trim() }), 'error');
    return { ok: false, wert: null };
  }
  if (el.id && G(el.id + '-fehler')) feldFehler(el.id, '');
  return { ok: true, wert };
}

/**
 * Prozent in der Form der Oberfläche (de-DE „+51,1 %“, en-GB „+51.1%“), damit
 * sie neben den Beträgen aus fmtN() nicht in einer zweiten Schreibweise steht.
 * @param {number|string} v  Prozentwert (51.1, nicht 0.511)
 * @param {{vorzeichen?: boolean, stellen?: number}} [o]
 */
export function fmtPct(v, o = {}) {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  const stellen = o.stellen ?? 1;
  return new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: stellen,
    maximumFractionDigits: stellen, signDisplay: o.vorzeichen === false ? 'auto' : 'exceptZero' }).format(n / 100);
}
/** Grosse Anzahl kurz in der Sprache der Oberfläche: „1300“ → „1,3 Tsd.“ (de), „1.3K“ (en). */
export function fmtBig(n){
  const v = Number(n) || 0;
  if (v < 10000) return v.toLocaleString(locale());
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/**
 * Ein Datum überall gleich: „05.01.2024“ (de), „5 Jan 2024“ (en). Vorher
 * stand je Stelle toLocaleDateString() („5.1.2024“) neben eigenen Formen.
 * @param {string|number|Date|null|undefined} v
 * @param {'tag'|'zeit'|'tagzeit'|'lang'} [art]  lang: „1. Juni 2026“
 */
export function fmtDatum(v, art = 'tag'){
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v);
  if (isNaN(d.getTime())) return '';
  // Englisch mit Monatsnamen: „03/11/2026“ liest sich in den USA als 11. März.
  // Deutsch immer 24 Stunden, auch bei einem Browser mit 12-h-Vorgabe.
  const tag = LANG === 'en' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' };
  const zeit = LANG === 'en' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const o = art === 'zeit' ? zeit : art === 'tagzeit' ? { ...tag, ...zeit } : art === 'lang' ? { day: 'numeric', month: 'long', year: 'numeric' } : tag;
  return new Intl.DateTimeFormat(locale(), /** @type {Intl.DateTimeFormatOptions} */ (o)).format(d);
}

// ── LANGUAGE HELPERS ────────────────────────────────────────────────────────
export function setLang(lang) {
  applyLang(lang, true);
  _updateLangSelect();
}
export function _updateLangSelect() {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('lang-select'));
  if (sel) sel.value = LANG;
}

// ── FORMULARE ─────────────────────────────────────────────────────────────
/**
 * Fehler eines Formulars an die betroffenen Felder binden: aria-invalid
 * markiert das Feld, aria-describedby lässt Vorleser die Meldung beim Feld
 * nennen, und der Fokus springt in das erste, damit man gleich korrigiert.
 * Ohne Text verschwinden Meldung und Markierungen.
 * @param {HTMLElement} box  das Meldungsfeld (role=alert)
 * @param {string} text
 * @param {string[]} [felder] IDs der betroffenen Felder
 */
export function formularFehler(box, text, felder = []) {
  box.textContent = text; box.style.display = text ? 'block' : 'none';
  box.parentElement?.querySelectorAll('[aria-invalid="true"]').forEach(f => feldGueltig(f, box.id));
  const ziele = /** @type {HTMLElement[]} */ (felder.map(id => G(id)).filter(Boolean));
  for (const f of ziele) {
    f.setAttribute('aria-invalid', 'true');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); ids.add(box.id);
    f.setAttribute('aria-describedby', [...ids].join(' '));
  }
  if (text && ziele[0]) ziele[0].focus();
}
/** @param {Element} f @param {string} boxId */
function feldGueltig(f, boxId) {
  f.removeAttribute('aria-invalid');
  const rest = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== boxId);
  if (rest.length) f.setAttribute('aria-describedby', rest.join(' ')); else f.removeAttribute('aria-describedby');
}
// Wer im markierten Feld tippt, korrigiert: Die Markierung geht, die Meldung bleibt stehen.
if (typeof document !== 'undefined') document.addEventListener('input', (ev) => {
  const f = ev.target instanceof Element ? ev.target : null;
  if (f?.getAttribute('aria-invalid') === 'true') f.removeAttribute('aria-invalid');
});

// ── DESIGN, VORGABEN, NAMENSZUG ──────────────────────────────────────────
// Setzt das globale App-Design (vom Admin gewählt) als data-theme auf <html>.
// Das CSS bringt für [data-theme="brick"] das blaue Stein-Design mit.
//
// Die eigentliche Anwendung liegt in js/00-theme-boot.js, das schon im <head>
// läuft — sonst hätte der Login-Screen das Design erst nach dem Einloggen.
// Hier wird nur noch durchgereicht, damit der localStorage-Cache mitgeführt
// wird und ein Design-Wechsel des Admins beim nächsten Laden sofort greift.
export function applyTheme(theme){
  // ── Keine zweite Liste hier ────────────────────────────────
  //
  // Hier stand `if (theme !== 'brick' && theme !== 'classic') return null;` —
  // eine EIGENE Liste der gueltigen Designs, geschrieben, als es zwei gab.
  // Inzwischen sind es sechs. Die vier neueren wurden hier abgewiesen und
  // NIE angewendet: Der Wechsel wirkte erst beim naechsten Seitenaufruf,
  // wenn js/00-theme-boot.js den Serverwert aus dem <html>-Attribut liest.
  //
  // Marco: „Teilweise (nicht bei allen Designs) muss beim Aendern die Seite
  // neu geladen werden." Genau die zwei aus der alten Liste schalteten
  // sofort um, die vier danach nicht.
  //
  // Dieselbe Bauart wie der fehlende <link> eine Runde vorher: eine
  // handgepflegte Aufzaehlung von Designs, die beim Hinzufuegen des
  // naechsten nicht mitwaechst. Die Pruefung dazu steht in theme.test.js.
  //
  // Die gueltigen Werte kennt ausschliesslich js/00-theme-boot.js. Ohne
  // dieses Skript wird NICHTS gesetzt — lieber kein Design als ein
  // ungeprueftes Attribut.
  if (typeof window.__bimApplyTheme !== 'function') return null;
  return window.__bimApplyTheme(theme);
}

export async function initDefaultCondition(){
  try {
    // Effektiver Default des Nutzers (User-Override → global → 'N'), damit die
    // Erfassungsformulare den in den Einstellungen gewählten Zustand vorbelegen.
    const d = await api('GET', '/v1/settings/user/default-condition');
    if (d?.success && d.condition) {
      ['add-condition','ap-condition','af-condition'].forEach(id => {
        const el = G(id);
        if (el) el.value = d.condition;
      });
    }
  } catch(e) {}
}

/**
 * Den Namenszug in der Kopfleiste schreiben — mit dem Verwalter-Zusatz.
 *
 * ── Marcos Vorgabe vom 17.10. ───────────────────────────────────────────────
 *
 * „Kannst du das \"Admin\" nicht als eigene Kachel anzeigen sondern in ()
 * hinter dem Benuzter? Also z.b. marco.bigolin (Admin) oder marco.bigolin
 * sofern der User kein Admin ist."
 *
 * Die eigene Plakette (`#abadge`) ist damit aus der Kopfleiste verschwunden.
 * Sie war ein zweites Element, das dasselbe sagte wie der Name daneben — und
 * sie stand zwischen dem Namensknopf und dem rechten Rand, weshalb das Menü
 * nicht ganz rechts sass.
 *
 * ── Warum als EINE Funktion und nicht zweimal hingeschrieben ────────────────
 *
 * Geschrieben wird der Name an ZWEI Stellen: hier beim Anmelden und in
 * js/05-settings.js nach dem Ändern des Profils. Genau dort stand die Zeile
 * schon einmal falsch („uname" statt „ubadge") und lief ins Leere, ohne dass
 * es jemand merkte. Zwei Fassungen derselben Regel laufen auseinander; diese
 * hier ist die einzige.
 *
 * Der Zusatz kommt aus dem Sprachtext (`users.admin_badge`) und nicht als
 * Literal: Er stand schon übersetzt in der Plakette, und eine englische
 * Oberfläche soll nicht plötzlich „Admin" auf Deutsch zeigen.
 */
export function zeigeBenutzernamen(){
  const el = G('ubadge');
  if (!el || !ME) return;
  el.textContent = ME.isAdmin
    ? `${ME.username} (${tRaw('users.admin_badge')})`
    : ME.username;
}

registerActions({
  rbHinweisOeffnen,
  rbHinweisWeg,
});

// Die gewählte Sprache am Konto speichern (i18n.js meldet den Wechsel).
abonniere('spracheGewechselt', ({ sprache, speichern }) => {
  if (speichern) api('POST', '/v1/settings', { language: sprache });
});
