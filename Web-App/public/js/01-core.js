import { registerActions } from './00-registry.js';
import { resetScopeModes } from './14-scope.js';
import { I18N, LANG, applyLang, locale, t , setLangValue, tRaw} from '../i18n.js';
import { _csvPollActive, allSets, setAllSets, bindTabs, hideProgress, loadGallery, loadStats, showProgress } from './02-gallery.js';
import { queueCatalogImages, redownloadMissingImages, reimportMissingInstructions, toggleBricksetQueue, triggerCsvSync } from './07-admin.js';
import { plInit, resetPartsList } from './08-init.js';
import { clickJobTrigger, saveJobMinutes, saveJobTime } from './11-actions.js';

// ═══ Utils, i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken ═══
// (Der PDF-Betrachter lag bis Nachtrag 130 ebenfalls hier — jetzt js/12-pdfviewer.js.)
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── ESCAPING ───────────────────────────────────────────────────────────────
// Alle Listen und Detailansichten werden per innerHTML aus Template-Literalen
// gebaut. Jeder Wert, der aus der DB, einem CSV-Import oder einer Fremd-API
// kommt, MUSS deshalb durch einen dieser Helfer — sonst ist jedes freie
// Textfeld (Teilename, Farbname, Notiz, Bild-URL) ein Stored-XSS-Vektor.
// Faustregel:
//   Textinhalt oder doppelt-gequotetes Attribut  → esc()
//   Wert in einem JS-String im Attribut          → escJs()   z.B. data-click="fn" data-arg="${escJs(x)}"
//   src / href                                   → escUrl()
//   Farbwert in style=""                         → escHex()

/** HTML-Escape für Textinhalte und doppelt-gequotete Attributwerte. */
export function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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

/** Farbwert für style="background:…" — alles ausser 6 Hex-Ziffern fliegt raus. */
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
export function G(id) { return document.getElementById(id); }

/**
 * Einen Knopf für die Dauer eines Aufrufs sperren.
 *
 * ── Der Befund (Nachtrag 160) ───────────────────────────────────────────────
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
 * Der Wartetext ist „…" ohne Wort: Der Knopf ist gesperrt, das sagt genug, und
 * so bleibt der Vorgang sprachfrei. Genau das machte die Anmeldung schon
 * richtig, während die vier anderen Stellen es ausformulierten.
 *
 * @param {HTMLButtonElement} btn
 * @param {string} [laeuft] Wartetext. Vorgabe „…". Die PDF-Erzeugung gibt
 *   einen eigenen mit, weil sie ihn während des Laufs mehrfach wechselt
 *   (erstellen → Bilder → Restzeit).
 * @returns {(text?: string) => void} Freigabe. Ohne Argument kommt die
 *   ursprüngliche Beschriftung zurück; mit Argument eine andere — die
 *   QR-Erzeugung heisst danach absichtlich „Neu generieren".
 */
export function knopfBesetzt(btn, laeuft = '…') {
  const vorher = btn.textContent;
  btn.disabled = true;
  btn.textContent = laeuft;
  return (text) => { btn.disabled = false; btn.textContent = text ?? vorher; };
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
  if (src.startsWith('/data/') || src.startsWith('/images/') || src.startsWith('/api/img-proxy')) {
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
    return '/api/img-proxy?url=' + encodeURIComponent(src) + tp;
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
  if (src.startsWith('/api/img-proxy')) return src.replace(/&thumb=1\b/, '').replace(/&gen=0\b/, '');
  // Absolute Adresse (CDN) auch hier über den Proxy — vorher wurde sie
  // unverändert zurückgegeben, sodass Detailansicht und Zoom direkt beim CDN
  // luden. Siehe die Begründung in imgUrl().
  if (/^https?:\/\//.test(src)) return '/api/img-proxy?url=' + encodeURIComponent(src);
  return src.replace(/_thumb(\.[^.?]+)(\?|$)/, '$1$2');
}

/**
 * Wert für ein HTML-Attribut absichern. Wird für die Datenattribute des
 * Log-Fensters gebraucht: Token, Basis-URL und die Übersetzungen als JSON.
 */
/**
 * Papierkorb-Symbol für Löschknöpfe auf Kacheln und in Listenzeilen.
 *
 * `currentColor` statt fester Farbe: Der Knopf bestimmt die Farbe über sein
 * CSS (weiss auf rotem Grund bei .delbtn, rot auf hellem Grund bei .bd), das
 * Symbol übernimmt sie. So passt es in beide Umgebungen ohne zweite Fassung.
 */
export const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" '
  + 'style="width:1em;height:1em;display:block" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>'
  + '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
  + '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';

function escHtmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Bildadresse für eine lokale Datei — unverändert, wie vom Server geliefert.
 *
 * Vorher konstruierte diese Funktion aus JEDEM lokalen Pfad selbst eine
 * "_thumb.jpg"-Variante, unabhängig davon, ob diese Datei existiert.
 * `utils/images.ts` (Server, resolveImageLocal()) prüft das aber bereits: Es
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
          const img = e.target;
          if(img.complete) img.classList.add('loaded');
          img.addEventListener('load', ()=>img.classList.add('loaded'), {once:true});
          window._imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });
  }
  imgs.forEach(img => { img.classList.add('observed'); window._imgObserver.observe(img); });
}
export function toast(msg, type='info') {
  const c = G('toasts'), el = document.createElement('div');
  el.className=`toast ${type}`;
  // textContent statt innerHTML: msg enthält regelmässig Server-Fehlermeldungen
  // und Set-/Teilenummern aus Nutzereingaben.
  const icon = document.createElement('span');
  icon.textContent = {success:'✅',error:'❌',info:'ℹ️'}[type] || 'ℹ️';
  const text = document.createElement('span');
  text.textContent = String(msg ?? '');
  el.append(icon, text);
  c.appendChild(el); setTimeout(()=>el.remove(),4500);
}
/**
 * Aufruf der eigenen API. Liefert IMMER ein Objekt — nie eine Ausnahme.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Vorher stand hier `return (await fetch(...)).json()`, ohne Blick auf
 * res.ok. Antwortet irgendetwas mit einer nicht-JSON-Seite — ein 502 oder 504
 * vom Reverse Proxy, 413 bei zu grossem Körper, eine HTML-Fehlerseite —, warf
 * .json() einen SyntaxError:
 *
 *     Unexpected token '<', "<html>502 "... is not valid JSON
 *
 * Bei rund 88 Aufrufstellen ist längst nicht jede in try/catch. Für den
 * Benutzer hiess das: klicken, nichts passiert, keine Meldung. Die
 * Fehlerbehandlung war da — sie prüft `d.success` und zeigt `d.error` —, sie
 * bekam nur nie ein Objekt zu sehen.
 *
 * Deshalb wird jeder Fehlschlag in genau die Form gebracht, die der Server
 * auch liefern würde: { success: false, error: '…' }. Damit greifen alle
 * bestehenden Pfade unverändert, ohne dass 88 Stellen angefasst werden müssen.
 *
 * `status` und `networkError` hängen zusätzlich am Ergebnis, für die wenigen
 * Stellen, die genauer unterscheiden wollen (z. B. 401 → Anmeldemaske).
 */
export async function api(method, path, body) {
  // ── Accept-Language: die Sprache, die gerade AUF DEM BILDSCHIRM steht ──────
  //
  // Der Server hat seine Fehlermeldungen seit Nachtrag 130 in beiden Sprachen
  // (utils/fehlerTexte.ts) und antwortet in der, die hier steht. Vorher waren
  // alle 80 Meldungen deutsch — in einer sonst vollständig englischen
  // Oberfläche.
  //
  // `LANG` und nicht die Spracheinstellung des KONTOS: Wer die Oberfläche
  // umschaltet, will sofort alles in der neuen Sprache, auch die nächste
  // Fehlermeldung. Das Konto nachzuziehen ist ein eigener Vorgang.
  const o={method,headers:{'Content-Type':'application/json','Accept-Language':LANG}};
  if(body) o.body=JSON.stringify(body);
  let res;
  try {
    res = await fetch('/api'+path, o);
  } catch (e) {
    // Netzfehler: offline, Verbindungsabbruch, DNS. Kein Status vorhanden.
    console.warn('[api]', method, path, e);
    return { success:false, error:tRaw('api.unreachable'), networkError:true, status:0 };
  }
  let daten = null;
  try {
    daten = await res.json();
  } catch (_) {
    // Antwort war kein JSON. Bei einem Fehlerstatus ist das der Normalfall
    // (Proxy-Seite); bei 200 wäre es ein Fehler auf unserer Seite.
    console.warn('[api]', method, path, 'Antwort ist kein JSON (Status ' + res.status + ')');
    return { success:false, status:res.status,
             error: res.ok ? tRaw('api.unexpected') : tRaw('api.server_error', { status:res.status }) };
  }
  // JSON da, aber Fehlerstatus: success/error können fehlen (z. B. bei einer
  // Antwort aus einer Zwischenschicht) — dann selbst ergänzen.
  if (!res.ok && daten && typeof daten === 'object' && daten.success === undefined) {
    return { ...daten, success:false, status:res.status,
             error: daten.error || tRaw('api.server_error', { status:res.status }) };
  }
  if (daten && typeof daten === 'object') daten.status = res.status;
  if (res.status === 401) meldeSitzungBeendet(path);
  return daten;
}

/**
 * Antwortet der Server mit 401, ist die Sitzung nicht mehr gültig.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Bisher wurde daraus ein Hinweis pro Klick („Nicht angemeldet"), während die
 * Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen liess. Die
 * Android-App macht es längst richtig: Ihr Interceptor meldet jeden 401, die
 * App zeigt „Sitzung abgelaufen" und führt zurück zur Anmeldung.
 *
 * Wahrscheinlicher geworden ist der Fall durch die Sitzungs-Bereinigung beim
 * Passwortwechsel: Seitdem verwerfen alle drei Passwort-Wege sämtliche
 * Sitzungen des Kontos — offene Tabs auf anderen Geräten landen also genau
 * hier.
 *
 * Zwei Ausnahmen:
 *   • /v1/auth/me beantwortet die Frage „bin ich angemeldet?" — ein 401 ist dort
 *     die normale Antwort für „nein" und wird von checkAuth() behandelt.
 *   • /v1/auth/login meldet mit 401 ein falsches Passwort; die Anmeldemaske steht
 *     dann ohnehin schon auf dem Schirm.
 */
function meldeSitzungBeendet(path) {
  if (path.startsWith('/v1/auth/me') || path.startsWith('/v1/auth/login')) return;
  if (!ME) return;                       // war nie angemeldet — nichts zu beenden
  ME = null;
  toast(tRaw('auth.session_expired'), 'error');
  showLogin();
}
export function fmtN(v,cur){
  if(!v||v==0) return '—';
  return new Intl.NumberFormat(locale(),{style:'currency',currency:cur||'EUR',minimumFractionDigits:2}).format(v);
}
export function fmtBig(n){ return n>1e6?(n/1e6).toFixed(1)+'M':n>1e3?(n/1e3).toFixed(1)+'k':String(n); }

// ── LANGUAGE HELPERS ────────────────────────────────────────────────────────
export function setLang(lang) {
  applyLang(lang, true);
  _updateLangSelect();
}
export function _updateLangSelect() {
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = LANG;
}
// keep alias so existing calls still work
function _updateLangChips() { _updateLangSelect(); }

// ── AUTH & PANELS ─────────────────────────────────────
let _resetToken = null;

function showPanel(name){
  ['login','register','forgot','reset'].forEach(p => {
    const el = G('panel-'+p); if(el) el.style.display = p===name?'block':'none';
  });
}

// Check URL params on load
(function(){
  const params = new URLSearchParams(location.search);
  if(params.get('verified')==='1'){
    showPanel('login');
    const m=G('verified-msg'); if(m) m.style.display='block';
  } else if(params.get('token') && (location.pathname.includes('reset-password') || params.get('type') === 'reset')){
    _resetToken = params.get('token');
    showPanel('reset');
  }
  // Clean URL
  if(params.has('verified')||params.has('token')) history.replaceState({},'',location.pathname);
})();

// Panel links
G('link-register')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('register'); const rl=G('reg-lang'); if(rl && (LANG==='de'||LANG==='en')) rl.value=LANG; });
G('link-forgot')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('forgot'); });
G('link-to-login')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('login'); });
G('link-forgot-to-login')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('login'); });

// Register
G('btn-register')?.addEventListener('click', async () => {
  const u=G('reg-user').value.trim(), e=G('reg-email').value.trim();
  const p=G('reg-pass').value, p2=G('reg-pass2').value;
  const err=G('reg-err');
  err.style.display='none';
  if(!u||!e||!p){ err.textContent=tRaw('register.req_fields'); err.style.display='block'; return; }
  if(p!==p2){ err.textContent=tRaw('settings.password.mismatch'); err.style.display='block'; return; }
  const btn=G('btn-register'); const frei=knopfBesetzt(btn);
  const d=await api('POST','/v1/auth/register',{
    username:u, email:e, first_name:G('reg-first').value.trim()||null,
    last_name:G('reg-last').value.trim()||null, password:p,
    language: G('reg-lang')?.value || LANG || 'de'
  });
  frei();
  if(d.success){
    G('reg-form').style.display='none';
    G('reg-success').style.display='block';
    G('reg-success').textContent = d.message;
    if(d.console_mode) G('reg-success').textContent += t('register.console_hint');
  } else { err.textContent=d.error||t('settings.error'); err.style.display='block'; }
});

// Forgot password
G('btn-forgot')?.addEventListener('click', async () => {
  const email=G('forgot-email').value.trim();
  const err=G('forgot-err');
  err.style.display='none';
  if(!email){ err.textContent=tRaw('register.email_required'); err.style.display='block'; return; }
  const btn=G('btn-forgot'); const frei=knopfBesetzt(btn);
  const d=await api('POST','/v1/auth/forgot-password',{email});
  frei();
  G('forgot-form').style.display='none';
  G('forgot-success').style.display='block';
  G('forgot-success').textContent = d.message || 'Falls die E-Mail existiert, wurde ein Link gesendet.';
});

// Reset password
G('btn-reset')?.addEventListener('click', async () => {
  const p=G('reset-pass').value, p2=G('reset-pass2').value;
  const err=G('reset-err');
  err.style.display='none';
  if(!p||p!==p2){ err.textContent=tRaw('settings.password.mismatch'); err.style.display='block'; return; }
  if(!_resetToken){ err.textContent=tRaw('reset.invalid_token'); err.style.display='block'; return; }
  const btn=G('btn-reset'); btn.disabled=true; btn.textContent=tRaw('reset.saving');
  const d=await api('POST','/v1/auth/reset-password',{token:_resetToken,password:p});
  btn.disabled=false; btn.textContent=tRaw('reset.button');
  if(d.success){
    G('reset-form').style.display='none';
    G('reset-success').style.display='block';
    G('reset-success').textContent=tRaw('reset.done');
    setTimeout(()=>showPanel('login'),2000);
  } else { err.textContent=d.error||t('settings.error'); err.style.display='block'; }
});

// ── AUTH ──────────────────────────────────────────────
export let ME=null;
export let CURRENCY='EUR';
export let _settingsCache=null;
// Setzt das globale App-Design (vom Admin gewählt) als data-theme auf <html>.
// Das CSS bringt für [data-theme="brick"] das blaue Stein-Design mit.
//
// Die eigentliche Anwendung liegt in js/00-theme-boot.js, das schon im <head>
// läuft — sonst hätte der Login-Screen das Design erst nach dem Einloggen.
// Hier wird nur noch durchgereicht, damit der localStorage-Cache mitgeführt
// wird und ein Design-Wechsel des Admins beim nächsten Laden sofort greift.
export function applyTheme(theme){
  // Unbekannter Wert = keine Information. NICHT auf 'classic' zurückfallen:
  // /settings/raw liefert app_theme nicht garantiert, und ein Reset an dieser
  // Stelle liess die Seite beim Login sichtbar umspringen.
  if (theme !== 'brick' && theme !== 'classic') return null;
  if (typeof window.__bimApplyTheme === 'function') return window.__bimApplyTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
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

export async function checkAuth(){
  // Sprache (aus localStorage oder Browser-Sprache) sofort anwenden, damit auch
  // der Login-/Registrierungs- und Startup-Screen VOR dem Login übersetzt sind
  // (bisher lief applyLang erst nach dem Login in showApp).
  applyLang(LANG, false);
  await waitForStartup();
  const d=await api('GET','/v1/auth/me');
  // Seit dem Zusammenlegen der Anmeldung steht der Nutzer unter `user` und
  // das Admin-Kennzeichen heisst `is_admin` — dieselbe Form wie in der
  // Antwort des Logins und dieselbe, die die App liest. ME behält seine
  // gewohnten Felder (isAdmin, id, username), damit die Oberfläche
  // unverändert bleibt.
  if(d.loggedIn){ ME = { ...d, ...(d.user||{}), isAdmin: d.user?.is_admin === true }; showApp(); }
  else {
    G('login-screen').style.display='flex';
    G('app').style.display='none';
    // Don't override reset/verified panels that were already set from URL params
    if(!_resetToken && !G('verified-msg')?.style.display.includes('block')){
      showPanel('login');
    }
    checkRegistrationEnabled();
  }
}
async function waitForStartup() {
  const ss = G('startup-screen');
  if (ss) ss.style.display = 'flex';
  const startedAt = Date.now();
  // Kein hartes Gesamt-Timeout mehr: Download/Import der Rebrickable-CSVs kann
  // bei einer Neuinstallation viele Minuten dauern. Stattdessen nur abbrechen,
  // wenn sich der Fortschritt über längere Zeit gar nicht mehr ändert (Server
  // hängt) — solange Fortschritt gemeldet wird, wird weiter gewartet.
  const STALL_TIMEOUT = 180000; // 3 Min ohne jede Statusänderung → aufgeben
  let lastChangeAt = Date.now();
  let lastSig = '';
  while (true) {
    try {
      const r = await fetch('/api/v1/startup-status?_=' + Date.now(), {
        cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }
      });
      const s = await r.json();
      if (!s) { await new Promise(r=>setTimeout(r,600)); continue; }
      const pct = s.total > 0 ? Math.round(s.progress / s.total * 100) : 0;
      const stepEl = G('startup-step');
      const barEl  = G('startup-bar');
      const pctEl  = G('startup-pct');
      if (stepEl) stepEl.textContent = s.step || t('startup.loading');
      if (barEl)  barEl.style.width  = pct + '%';
      if (pctEl)  pctEl.textContent  = pct + '%';
      const subVal   = s.sub || '';
      const subWrap  = G('startup-sub-wrap');
      const subLabel = G('startup-sub-label');
      const subBar   = G('startup-sub-bar');
      const subPctEl = G('startup-sub-pct');
      const subEl    = G('startup-sub');
      if (subVal && subWrap) {
        subWrap.style.display = '';
        if (subLabel) subLabel.style.display = '';
        const subPct = subVal.match(/(\d+)%/);
        if (subPct) {
          if (subBar)   subBar.style.width  = subPct[1] + '%';
          if (subPctEl) subPctEl.textContent = subPct[1] + '%';
          if (subEl)    subEl.textContent    = s.step || '';
        } else {
          if (subBar)   subBar.style.width  = '0%';
          if (subPctEl) subPctEl.textContent = subVal;
          if (subEl)    subEl.textContent    = s.step || '';
        }
      } else if (subWrap) {
        subWrap.style.display = 'none';
        if (subLabel) subLabel.style.display = 'none';
      }
      // Fortschritt erkennen: ändert sich Schritt, Prozent oder Sub-Status,
      // gilt der Startvorgang als aktiv und der Stall-Timer wird zurückgesetzt.
      const sig = `${s.step}|${s.progress}|${s.total}|${s.sub || ''}`;
      if (sig !== lastSig) { lastSig = sig; lastChangeAt = Date.now(); }
      if (s.ready) break;
      if (Date.now() - lastChangeAt > STALL_TIMEOUT) { console.warn('[startup] stalled — no progress'); break; }
    } catch(e) { console.warn('[startup] poll error:', e.message); }
    await new Promise(r => setTimeout(r, 600));
  }
  if (ss) ss.style.display = 'none';
}

export let _monitorTimer = null;

// ── Global CSV Import Progress Bar ───────────────────────────────────────────
export let _gibTimer       = null;   // Polling-Fallback-Timer (nur wenn SSE scheitert)
export let _gibSse         = null;   // aktive EventSource (SSE), falls verfügbar
let _gibExpanded    = false;
let _gibLastCount   = 0;

// Rendert einen Import-Status ins UI. Quelle (SSE oder Polling) ist egal.
function gibApplyStatus(s) {
  if (!s || !s.success || !s.status) { gibStop(); return; }

  const running = s.status === 'running' || s.status === 'pending';
  const done    = s.done || 0;
  const total   = s.total || 0;
  const pct     = total > 0 ? Math.round(done / total * 100) : 0;

  // Update header bar
  const _gibEl = G('global-import-bar');
  if (_gibEl) {
    if (running) _gibEl.style.display = 'flex';
    G('gib-fill').style.width = pct + '%';
    G('gib-text').textContent = running
      ? `${done}/${total} (${pct}%)`
      : `✅ ${s.ok} ok${s.warn ? ', '+s.warn+' ⚠️' : ''}${s.err ? ', '+s.err+' ❌' : ''}`;
  }

  // Update overlay whenever it's open (both browser 1 minimized+reopened, and browser 2)
  const overlayOpen = G('progress-overlay')?.classList.contains('open');
  if (overlayOpen) {
    G('prog-title-txt').textContent = tRaw('csv.import_title');
    G('prog-bar').style.width = pct + '%';
    if (running) {
      G('prog-footer').textContent = `${t('csv.sets_progress',{done,total})} (${s.ok} ok${s.warn ? ', '+s.warn+' ⚠️' : ''}${s.err ? ', '+s.err+' ❌' : ''})`;
      if (s.current) G('prog-set-name').textContent = `Verarbeite: ${s.current} (${done}/${total})`;
    } else {
      G('prog-footer').textContent = `${t('csv.finished')} ${s.ok} ok${s.warn ? ', '+s.warn+' '+t('csv.warnings') : ''}${s.err ? ', '+s.err+' '+t('csv.errors') : ''}`;
      G('prog-set-name').textContent = '';
    }
  }

  // Update detail panel
  G('gib-stats').textContent = `${s.ok||0} ✅ · ${s.warn||0} ⚠️ · ${s.err||0} ❌`;
  const gpw = G('gib-prog-wrap');
  if (gpw && running) {
    gpw.style.display = 'block';
    G('gib-panel-fill').style.width = pct + '%';
    G('gib-panel-footer').textContent = `${t('csv.sets_progress',{done,total})} (${pct}%)`;
    if(s.current) G('gib-panel-set').textContent = `Verarbeite: ${s.current}`;
  }
  G('gib-stats').textContent = `${s.ok || 0} ok · ${s.warn || 0} ${t('csv.warnings')} · ${s.err || 0} ${t('csv.errors')}`;

  // Add new log entries — but only if the CSV poll loop isn't already writing them
  // (_csvPollActive = true means this window started the import and the CSV loop handles logs)
  if (!_csvPollActive && s.results && s.results.length > _gibLastCount) {
    s.results.slice(_gibLastCount).forEach(r => {
      if (r.success) gibAddLog('✅ ' + r.set_number + ' – ' + (r.action === 'added' ? t('common.added') : t('common.updated')), true);
      else if (r.isWarning) gibAddLog('⚠️ ' + r.set_number + ': ' + r.error, false);
      else gibAddLog('❌ ' + r.set_number + ': ' + (r.error || t('settings.error')), false);
    });
  }
  if (s.results) _gibLastCount = s.results.length;

  if (!running) {
    // Import done — only hide the header bar, never auto-close the overlay dialog
    setTimeout(() => {
      G('global-import-bar').style.display='none';
      G('import-detail-panel').classList.remove('open');
      _gibExpanded = false;
      // Don't clear log or close overlay — user may still be reading results
    }, 5000);
    // Show close button so user can dismiss the overlay when ready
    const btnClose = G('btn-close-import');
    if (btnClose) btnClose.style.display = '';
    loadGallery(); loadStats();
    gibStop();
  }
}

// Polling-Fallback: einmalig den Status holen und rendern.
async function gibPoll() {
  try {
    const wt = sessionStorage.getItem('webToken');
    const headers = wt ? { 'Authorization': 'Bearer ' + wt } : {};
    const s = await fetch('/api/v1/sets/import/csv/status', { headers, credentials: 'include' }).then(r=>r.json());
    gibApplyStatus(s);
  } catch(_) {}
}

function gibToggle() {
  if (!ME) return;
  const overlay = G('progress-overlay');
  if (overlay && overlay.classList.contains('open')) {
    // Already open — minimize back to header bar
    hideProgress();
  } else if (overlay) {
    // Opening from header bar click — initialize overlay in CSV mode
    // so gibPoll() can write into it (needed when this is a 2nd browser window)
    if (!_csvPollActive) {
      showProgress(t('csv.import_title'), true);
      // Immediately fill with whatever gibPoll already knows
      gibPoll();
    } else {
      // This window already owns the import loop — just re-show
      overlay.classList.add('open');
    }
  }
}


function gibAddLog(text, ok) {
  // Write to both the overlay csv-log AND the gib detail log
  for (const logId of ['csv-log', 'gib-log']) {
    const log = G(logId);
    if (!log) continue;
    const line = document.createElement('div');
    line.className = 'csv-log-line ' + (ok ? 'ok' : 'er');
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
}

// Startet die Live-Überwachung: bevorzugt SSE, mit automatischem Fallback auf
// Polling, falls der Browser kein EventSource kann oder der Stream scheitert.
export function gibStart() {
  if (_gibSse || _gibTimer) return; // läuft bereits
  _gibLastCount = 0;
  G('gib-log').innerHTML = '';
  G('global-import-bar').style.display = 'flex';
  G('gib-text').textContent = tRaw('csv.running_text');
  G('gib-fill').style.width = '0%';

  // SSE benötigt den Token in der URL, da EventSource keine Header setzen kann.
  // (Cookie-Session funktioniert ohnehin; der Token deckt den Bearer-Fall ab.)
  const wt = sessionStorage.getItem('webToken');
  const url = '/api/v1/sets/import/csv/stream' + (wt ? ('?token=' + encodeURIComponent(wt)) : '');

  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(url, { withCredentials: true });
      _gibSse = es;
      es.onmessage = (e) => {
        try { gibApplyStatus(JSON.parse(e.data)); } catch(_) {}
      };
      es.onerror = () => {
        // Verbindung verloren/abgelehnt → auf Polling zurückfallen,
        // aber nur solange noch kein Fallback läuft.
        es.close();
        if (_gibSse === es) _gibSse = null;
        if (!_gibTimer) { _gibTimer = setInterval(gibPoll, 1500); gibPoll(); }
      };
      return;
    } catch(_) { /* fällt unten auf Polling zurück */ }
  }
  // Kein EventSource verfügbar → Polling
  _gibTimer = setInterval(gibPoll, 1500);
  gibPoll();
}

function gibStop() {
  if (_gibSse)   { try { _gibSse.close(); } catch(_) {} _gibSse = null; }
  if (_gibTimer) { clearInterval(_gibTimer); _gibTimer = null; }
}

// Start polling when app loads (picks up import from any window)
async function gibCheckOnLoad() {
  if (_gibCheckTimer) return;
  let failures = 0;

  async function doCheck() {
    if (_gibTimer || _gibSse) { clearInterval(_gibCheckTimer); _gibCheckTimer=null; return; }
    // Ohne Anmeldung gibt es nichts zu prüfen — vorher lief die Abfrage auch
    // auf dem Login-Screen im Drei-Sekunden-Takt weiter.
    if (!ME) return;
    try {
      const wt = sessionStorage.getItem('webToken');
      const headers = wt ? { 'Authorization': 'Bearer ' + wt } : {};
      const r = await fetch('/api/v1/sets/import/csv/status', { headers, credentials: 'include' });

      // Antwort erst prüfen, dann parsen. Steht ein Reverse-Proxy oder Tunnel
      // davor, liefert der bei Neustart oder Aussetzer eine HTML-Fehlerseite —
      // r.json() warf dann "Unexpected token '<'". Das ist kein Fehler der
      // App, soll aber auch keinen Stacktrace in der Konsole erzeugen.
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('application/json')) {
        if (++failures === 3) console.warn('[gibCheck] Antwort ist kein JSON (Status ' + r.status + ') — Abfrage pausiert');
        // Nach mehreren Fehlschlägen langsamer weiterversuchen statt im
        // Drei-Sekunden-Takt gegen eine Wand zu laufen.
        if (failures >= 3 && _gibCheckTimer) {
          clearInterval(_gibCheckTimer);
          _gibCheckTimer = setInterval(doCheck, 30000);
        }
        return;
      }
      failures = 0;
      const s = await r.json();
      if (s.success && (s.status === 'running' || s.status === 'pending')) {
        clearInterval(_gibCheckTimer); _gibCheckTimer=null;
        gibStart();
      }
    } catch(e) {
      if (++failures === 3) console.warn('[gibCheck] nicht erreichbar — Abfrage verlangsamt');
    }
  }
  doCheck(); // fire immediately on login
  _gibCheckTimer = setInterval(doCheck, 3000); // then every 3s
}
let _gibCheckTimer = null;
function openLogViewer() {
  const win = window.open('', '_blank', 'width=1200,height=750,resizable=yes,scrollbars=yes');
  if (!win) { alert(tRaw('popup.blocked')); return; }
  const token = localStorage.getItem('authToken') || '';
  const base  = window.location.origin;

  const css = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:monospace;background:#0d1117;color:#e6edf3;display:flex;flex-direction:column;height:100vh;overflow:hidden}',
    'header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}',
    'h1{font-size:.95rem;font-weight:700;color:#58a6ff;white-space:nowrap}',
    'select,input[type=text]{font-family:monospace;font-size:.8rem;padding:4px 8px;border-radius:5px;border:1px solid #30363d;background:#21262d;color:#e6edf3}',
    'input[type=text]{width:200px}input[type=text]::placeholder{color:#8b949e}',
    'button{font-family:monospace;font-size:.8rem;padding:4px 10px;border-radius:5px;border:1px solid #30363d;background:#21262d;color:#e6edf3;cursor:pointer;white-space:nowrap}',
    'button:hover{background:#30363d}button.active{background:#1f6feb;border-color:#388bfd;color:#fff}',
    '.sep{color:#30363d;font-size:.8rem}#status{font-size:.75rem;color:#8b949e;white-space:nowrap}',
    '#log-wrap{flex:1;overflow-y:auto;padding:4px 0}',
    '.ll{padding:1px 14px;font-size:.76rem;line-height:1.55;white-space:pre-wrap;word-break:break-all;border-left:3px solid transparent;display:flex;gap:8px}',
    '.ll:hover{background:#161b22}.ll.warn{color:#e3b341;border-left-color:#e3b341}',
    '.ll.error{color:#f85149;border-left-color:#f85149;background:#16040a}',
    '.ll.info{color:#c9d1d9;border-left-color:#21262d}',
    '.ts{color:#8b949e;flex-shrink:0;user-select:none}.lv{flex-shrink:0;width:38px;font-weight:700;text-transform:uppercase;font-size:.68rem}',
    '.lv.info{color:#58a6ff}.lv.warn{color:#e3b341}.lv.error{color:#f85149}.msg{flex:1}',
    'mark{background:#e3b34133;color:inherit;border-radius:2px}',
    '.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.lvbtn{padding:3px 9px;font-size:.75rem}',
    '.lvbtn.info-btn.active{background:#1f3b6e;border-color:#58a6ff;color:#58a6ff}',
    '.lvbtn.warn-btn.active{background:#3b2f0e;border-color:#e3b341;color:#e3b341}',
    '.lvbtn.error-btn.active{background:#3b0f0f;border-color:#f85149;color:#f85149}',
  ].join('\n');

  // Die Zeitspannen als Daten statt als sechs ausgeschriebene <option>: So
  // steht die Beschriftung EINMAL da, in der Sprache des Nutzers. Vorher
  // waren es sechs deutsche Literale — in einem Fenster, das ein englischer
  // Verwalter genauso oeffnet.
  const spannen = [15, 30, 60, 360, 1440, 2880].map((min) => {
    const text = min < 60 ? t('log.minutes_n', { n: min })
      : min === 60 ? t('log.hour_1')
      : t('log.hours_n', { n: min / 60 });
    return '<option value="' + min + '">' + text + '</option>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="' + escHtmlAttr(LANG) + '"><head>' +
    '<meta charset="UTF-8"><title>' + esc(t('log.title')) + '</title>' +
    '<style>' + css + '</style>' +
    '</head><body' +
      ' data-auth="' + escHtmlAttr(token) + '"' +
      ' data-base="' + escHtmlAttr(base) + '"' +
      ' data-i18n="' + escHtmlAttr(JSON.stringify({
        'common.loading':       t('common.loading'),
        'common.network_error': t('common.network_error'),
        'log.none_found':       t('log.none_found'),
        'log.entries':          t('log.entries'),
        'toast.error':          t('toast.error'),
        // Die beiden Beschriftungen des Auto-Knopfes wechseln zur Laufzeit;
        // logviewer.js hatte sie deshalb als deutsche Literale.
        'log.auto':             t('log.auto'),
        'log.stop':             t('log.stop'),
      })) + '">' +
    '<header>' +
      '<h1>' + esc(t('log.title')) + '</h1>' +
      '<div class="toolbar">' +
        '<select id="period" data-change="loadLogs">' + spannen + '</select>' +
        '<span class="sep">|</span>' +
        '<button class="lvbtn info-btn" id="btn-info" data-click="toggleLevel" data-arg="info">\u2139 Info</button>' +
        '<button class="lvbtn warn-btn active" id="btn-warn" data-click="toggleLevel" data-arg="warn">\u26A0 Warn</button>' +
        '<button class="lvbtn error-btn active" id="btn-error" data-click="toggleLevel" data-arg="error">\u2716 Error</button>' +
        '<span class="sep">|</span>' +
        '<input id="search" type="text" placeholder="' + escHtmlAttr(t('log.search')) + '" data-input="renderLogs">' +
        '<span class="sep">|</span>' +
        '<button data-click="loadLogs">'+t('log.reload')+'</button>' +
        '<button data-click="toggleAuto" id="btn-auto">' + esc(t('log.auto')) + '</button>' +
        '<span id="status">\u2013</span>' +
      '</div>' +
    '</header>' +
    '<div id="log-wrap"></div>' +
    '<script src="/js/logviewer.js?v=' + (window.__APP_VERSION || Date.now()) + '"><\/script>' +
    '</body></html>';

  win.document.write(html);
  win.document.close();
}

// Übersetzt Server-seitige Job-Sub-Texte (background jobs kennen die
// Nutzersprache nicht). Bekannte Muster werden clientseitig ersetzt.
function translateJobSub(sub) {
  if (!sub) return '';
  let m;
  m = sub.match(/^Alle (\d+) gemappt$/);
  if (m) return t('monitor.sub.all_mapped', {n: m[1]});
  if (sub === 'Alle erledigt') return t('monitor.sub.all_done');
  m = sub.match(/^Alle (\d+) Bilder gecacht$/);
  if (m) return t('monitor.sub.imgs_cached', {n: m[1]});
  if (sub === 'Alle Bilder gecacht') return t('monitor.sub.imgs_cached', {n: '✓'});
  if (/^Keine aktiven/.test(sub)) return t('monitor.sub.no_active');
  m = sub.match(/^(\d+) Sets bereit zum Retry, (\d+) warten$/);
  if (m) return t('monitor.sub.retry_ready', {n: m[1], w: m[2]});
  m = sub.match(/^(\d+) aktualisiert, (\d+) Fehler — ([\d.]+)s$/);
  if (m) return t('monitor.sub.updated_errors', {upd: m[1], err: m[2], sec: m[3]});
  if (sub === 'Starte\u2026' || sub === 'Starte...') return t('monitor.starting');
  return sub; // unrecognised: pass through as-is
}

// Speichert den Zeitplan eines Jobs (Monitoring). payload = {time:"HH:MM"} oder {minutes:n}.
export async function saveJobSchedule(name, payload) {
  const d = await api('POST', '/v1/admin/job-schedule', { name, ...payload }).catch(() => null);
  if (d?.success) toast(tRaw('monitor.sched.saved'), 'success');
  else toast(d?.error || t('settings.error'), 'error');
}


export async function loadMonitor() {
  const el = G('monitor-content');
  if (!el) return;
  if (_monitorTimer) clearInterval(_monitorTimer);
  const render = async () => {
    const d = await fetch('/api/v1/admin/jobs').then(r=>r.json()).catch(()=>null);
    if (!d?.success) return;
    // Nicht neu rendern, während der Nutzer gerade eine Zeitplan-Eingabe bearbeitet
    // (sonst würde das 3s-Re-Render die Eingabe/den Fokus verwerfen).
    const _ae = document.activeElement;
    if (_ae && _ae.classList && _ae.classList.contains('job-sched-input')) return;
    const { jobs, db: dbStats, schedules } = d;
    // Zeitplan-Control je Job: tägliche Jobs -> Uhrzeit (HH:MM), Preis-Job -> Intervall (min).
    const schedInput = (k) => {
      const sc = schedules?.[k];
      if (!sc) return '';
      if (sc.type === 'daily') {
        return `<input type="time" class="job-sched-input" value="${sc.time}" title="${t('monitor.sched.daily_hint')}" data-change="saveJobTime" data-arg="${esc(k)}" style="font-size:.75rem;padding:2px 5px;border:1px solid var(--bdr);border-radius:6px;background:var(--sur);color:var(--txt)">`;
      }
      if (sc.type === 'interval') {
        return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem;color:var(--mut)" title="${t('monitor.sched.interval_hint')}"><input type="number" min="5" class="job-sched-input" value="${sc.minutes}" data-change="saveJobMinutes" data-arg="${esc(k)}" style="width:54px;font-size:.75rem;padding:2px 5px;border:1px solid var(--bdr);border-radius:6px;background:var(--sur);color:var(--txt)"> ${t('monitor.sched.min')}</span>`;
      }
      return '';
    };
    const jobIconSvg = (k) => {
      const svgs = {
        // CSV-Import (Rebrickable): kleine Tabelle/Raster mit farbigen Zeilen
        csvImport: '<rect x="12" y="20" width="96" height="18" rx="2" fill="#0055BF"/><rect x="12" y="44" width="96" height="18" rx="2" fill="#F2CD37"/><rect x="12" y="68" width="96" height="18" rx="2" fill="#E63329"/><rect x="12" y="92" width="96" height="18" rx="2" fill="#9BA19D"/>',
        // BrickLink IDs nachladen: zwei verbundene Ringe (Verknüpfung/Mapping)
        blIds: '<path d="M40,45 a20,20 0 1,0 0.1,0" fill="none" stroke="#0055BF" stroke-width="12"/><path d="M80,75 a20,20 0 1,0 0.1,0" fill="none" stroke="#E63329" stroke-width="12"/>',
        // Handbücher herunterladen: kleines aufgeschlagenes Buch
        instrQueue: '<path d="M60,28 C50,22 30,20 16,24 L16,92 C30,88 50,90 60,96 Z" fill="#E63329"/><path d="M60,28 C70,22 90,20 104,24 L104,92 C90,88 70,90 60,96 Z" fill="#CC2A21"/><rect x="24" y="38" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="50" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="62" width="20" height="4" rx="2" fill="#fff"/>',
        // Preise aktualisieren: Preisschild (Gold) mit Loch
        priceJob: '<path d="M18,60 L58,20 L100,20 Q108,20 108,28 L108,70 Q108,78 100,78 L58,100 Z" fill="#F2CD37"/><circle cx="84" cy="42" r="9" fill="#fff"/>',
      };
      return svgs[k] ? `<svg width="16" height="16" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">${svgs[k]}</svg>` : '';
    };
    const statusIcon = (s, j) => {
      if (s === 'running') return '⏳';
      if (s === 'done')    return '✅';
      if (s === 'error')   return '❌';
      // idle: show warning if there's pending work (total > progress or sub mentions pending)
      if (s === 'idle' && j.total > 0 && j.progress < j.total) return '⚠️';
      return '💤';
    };
    const bar = (v,t) => {
      if (!t) return '';
      const pct = Math.min(100, Math.round(v/t*100));
      return `<div style="background:var(--s100);border-radius:4px;height:6px;margin-top:4px"><div style="background:var(--b500);height:100%;border-radius:4px;width:${pct}%;transition:width .3s"></div></div>`;
    };
    // Preserve brickset queue panel if currently open
    const existingPanel = G('brickset-queue-panel');
    const panelOpen     = existingPanel && existingPanel.style.display !== 'none';
    const panelHTML     = panelOpen ? existingPanel.innerHTML : null;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        ${Object.entries(jobs).map(([k,j])=>`
          <div class="card" style="padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
              <span style="font-weight:600;font-size:.9rem;display:inline-flex;align-items:center;gap:6px">${k==='bricksetRetry' ? '<svg width="16" height="16" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/></svg>' : jobIconSvg(k)}${t('monitor.job.'+k, {}) !== 'monitor.job.'+k ? t('monitor.job.'+k) : (j.label||'')}</span>
              <div style="display:flex;align-items:center;gap:.5rem">
                ${schedInput(k)}
                ${k==='priceJob' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="clickJobTrigger">${t('monitor.run_now')}</button>` : ''}
                ${k==='instrQueue' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="reimportMissingInstructions" data-self="1">${t('monitor.import_missing')}</button>` : ''}
                ${k==='csvImport' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="triggerCsvSync" data-self="1">${t('monitor.sync_now')}</button>` : ''}
                ${k==='imgDl' && j.canRedownload ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="redownloadMissingImages" data-self="1">${t('monitor.redownload_missing')}</button>` : ''}
                ${k==='imgDl' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="queueCatalogImages" data-self="1">${t('monitor.catalog_images')}</button>` : ''}
                ${k==='bricksetRetry' && j.total > 0 ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem;display:inline-flex;align-items:center;gap:5px" data-click="toggleBricksetQueue" data-self="1"><svg width="14" height="14" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/></svg> ${t('monitor.show')}</button>` : ''}
                <span title="${esc(j.status)}">${statusIcon(j.status, j)}</span>
              </div>
            </div>
            ${j.sub ? `<div style="font-size:.8rem;color:var(--mut)">${translateJobSub(j.sub)}</div>` : ''}
            ${j.total > 0 ? bar(j.progress, j.total) : ''}
            ${j.lastRun ? `<div style="font-size:.72rem;color:var(--mut);margin-top:.4rem">${t('monitor.last_run')} ${new Date(j.lastRun).toLocaleTimeString(locale())}</div>` : ''}
            ${k==='bricksetRetry' ? `<div id="brickset-queue-panel" style="display:none;margin-top:.75rem"></div>` : ''}
          </div>`).join('')}
      </div>
      <div class="card" style="padding:1rem;margin-top:.5rem">
        <div style="font-weight:600;margin-bottom:.75rem">${t('monitor.db')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;font-size:.83rem">
          <div><div style="color:var(--mut)">${t('monitor.last_sync')}</div><div style="font-weight:600">${dbStats.csvCache.lastSync||'–'}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.parts_cached')}</div><div style="font-weight:600">${(dbStats.csvCache.parts||0).toLocaleString(locale())}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.inventory_parts')}</div><div style="font-weight:600">${(dbStats.csvCache.inventoryParts||0).toLocaleString(locale())}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.bl_mapped')}</div><div style="font-weight:600">${(dbStats.blMapping.mapped||0).toLocaleString(locale())} / ${(dbStats.blMapping.total||0).toLocaleString(locale())}</div></div>
        </div>
      </div>`;

    // Restore panel state if it was open before re-render
    if (panelOpen && panelHTML !== null) {
      const newPanel = G('brickset-queue-panel');
      if (newPanel) {
        newPanel.innerHTML = panelHTML;
        newPanel.style.display = 'block';
        // Update toggle button text
        const toggleBtn = newPanel.closest('.card')?.querySelector('button.btn.bs');
        if (toggleBtn && toggleBtn.textContent.includes(t('monitor.show'))) toggleBtn.textContent = tRaw('monitor.collapse');
      }
    }

    // Refresh faster when img-dl or PDF jobs are actively running
    const anyActive = Object.values(jobs).some(j => j.status === 'running');
    const interval = anyActive ? 2000 : 5000;
    if (_monitorTimer) clearInterval(_monitorTimer);
    _monitorTimer = setInterval(render, interval);
  };
  await render();
}

function showLogin(){
  // Hide import bar completely on login page
  const gib = G('global-import-bar');
  if(gib){ gib.style.display='none'; }

  gibStop(); if(_gibCheckTimer){clearInterval(_gibCheckTimer);_gibCheckTimer=null;} _gibLastCount=0; sessionStorage.removeItem('webToken');
  const gl = G('gib-log'); if(gl) gl.innerHTML='';
  // Clear sensitive data from all tabs before hiding
  ['fin-tbl','portfolio-chart-section','gallery-grid','parts-main','monitor-content'].forEach(id=>{
    const el=G(id); if(el) el.innerHTML='';
  });
  setAllSets([]);
  resetPartsList();
  // Clear partslist DOM so it doesn't persist after re-login
  const plResult=G('pl-result'); if(plResult) plResult.innerHTML='';
  const plSetsEl=G('pl-sets'); if(plSetsEl) plSetsEl.innerHTML='';
  const plStatus=G('pl-status'); if(plStatus) plStatus.textContent='';
  ['btn-pl-pdf','btn-pl-bl','pl-bl-condition'].forEach(id=>{const el=G(id);if(el)el.style.display='none';});
  G('login-screen').style.display='flex';
  G('app').style.display='none';
  showPanel('login');
  checkRegistrationEnabled();
}
async function checkRegistrationEnabled(){
  try {
    const d = await fetch('/api/v1/auth/registration-status').then(r=>r.json());
    const wrap = G('link-register-wrap');
    if(wrap) wrap.style.display = d.enabled ? '' : 'none';
  } catch(_){}
}



function showApp(){ bindTabs(); plInit(); console.log('[showApp] called, scheduling gibCheckOnLoad'); setTimeout(()=>{ console.log('[gibCheckOnLoad] firing'); gibCheckOnLoad(); }, 1000);
  G('login-screen').style.display='none'; G('app').style.display='block';
  G('ubadge').textContent=ME.username;
  initDefaultCondition();
  // Kontoauswahl beim Erfassen — bleibt verborgen, wenn es nichts zu wählen
  // gibt. Import aus 02-gallery.js gäbe einen Zyklus (dort wird api() aus
  // dieser Datei geholt), deshalb der späte dynamische Import.
  import('./02-gallery.js').then(m => m.loadHouseholdMembers?.()).catch(() => {});
  // Apply saved language immediately (from localStorage) so static elements translate before server responds
  setLangValue(localStorage.getItem('bim_lang') || LANG);
  applyLang(LANG, false);
  // Load settings — also picks up server-stored language preference
  api('GET','/v1/settings/raw').then(d=>{
    if(d.success&&d.settings){
      _settingsCache=d.settings;
      CURRENCY=d.settings.currency||'EUR';
      applyTheme(d.settings.app_theme);
      // Server language wins (explicit user choice), update localStorage too
      const srvLang = d.settings.language;
      if (srvLang && I18N[srvLang]) {
        if (srvLang !== LANG) applyLang(srvLang, false);
        localStorage.setItem('bim_lang', srvLang);
      }
    }
    _updateLangSelect();
  });
  if(ME.isAdmin){ document.querySelectorAll('.admin-only').forEach(el=>el.style.display=''); const nm=G('ntab-monitor'); if(nm){ nm.style.display=''; const lbl=nm.querySelector('.tab-label'); if(lbl) lbl.textContent=tRaw('nav.monitoring'); } G('abadge').style.display='inline-flex'; G('usermgmt').style.display='block'; ['bl-ao','rb-ao','bs-ao'].forEach(id=>{ const el=G(id); if(el) el.style.display='none'; }); const gg=G('global-settings-grid'); if(gg) gg.style.display='grid'; const gl=G('global-settings-label'); if(gl) gl.style.display='block'; }
  else { ['bl-ck','bl-cs','bl-tok','bl-ts','rb-key','bs-key','lim-rb','lim-bl','lim-bs'].forEach(id=>{const el=G(id);if(el){el.disabled=true;if(el.type!=='number')el.placeholder=tRaw('settings.admins_only_ph')}}); G('btn-sav-bl').disabled=true; G('btn-sav-rb').disabled=true; G('btn-sav-bs').disabled=true; }
  // Admin: check if API keys are set, redirect to settings if not
  // Re-use the already-fetched cache (populated above); if not ready yet, wait briefly
  if(ME.isAdmin) {
    const checkRbKey = () => {
      const s = _settingsCache || {};
      const hasRbKey = s.rebrickable_api_key && s.rebrickable_api_key.trim();
      if(!hasRbKey) {
        const ntab = document.querySelector('.ntab[data-tab="settings"]');
        if(ntab) ntab.click();
        toast(tRaw('rb_key.missing'),'info');
        return;
      }
      loadGallery();
    };
    if(_settingsCache) checkRbKey();
    else setTimeout(checkRbKey, 600); // wait for the parallel fetch above
  } else {
    loadGallery();
  }
  loadStats();
}
G('btn-login').onclick=doLogin;
['lu','lp'].forEach(id=>G(id).addEventListener('keydown',e=>e.key==='Enter'&&doLogin()));
async function doLogin(){
  const b=G('btn-login'); const frei=knopfBesetzt(b);
  const d=await api('POST','/v1/auth/login',{username:G('lu').value,password:G('lp').value});
  frei();
  if(d.success){ ME = { ...d, ...(d.user||{}), isAdmin: d.user?.is_admin === true }; if(d.token) sessionStorage.setItem('webToken',d.token);
    // Jede Anmeldung beginnt mit „Alle Konten" (Nachtrag 46) — VOR showApp(),
    // damit die Auswahlfelder gleich mit dem zurückgesetzten Wert entstehen.
    resetScopeModes();
    showApp(); } else { const err=d.error||t('settings.error'); G('lerr').textContent=err; G('lerr').style.display='block'; if(d.unverified){ G('lerr').innerHTML=err+' <a href="#" data-click="showPanel" data-arg="login" style="color:var(--b600)">E-Mail erneut senden?</a>'; } }
}
G('btn-logout').onclick=async()=>{
  // Den webToken MITSCHICKEN, sonst kann der Server ihn nicht entwerten.
  //
  // POST /api/v1/auth/logout beendet die Sitzung UND löscht den Bearer-Token —
  // aber nur, wenn er im Authorization-Header steht. api() setzt den Header
  // nicht (die Webapp arbeitet sonst per Session-Cookie), die Löschung lief
  // deshalb ins Leere: Der Token blieb nach dem Abmelden volle sieben Tage
  // gültig. Da er im sessionStorage liegt und damit per XSS auslesbar ist, ist
  // genau das der Fall, den ein bewusstes Abmelden ausschliessen soll.
  const _wt = sessionStorage.getItem('webToken');
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: _wt ? { 'Authorization': 'Bearer ' + _wt } : {},
  }).catch(()=>{});
  ME=null; setAllSets([]);
  // Reset all admin-only elements before showing login
  const nm=G('ntab-monitor'); if(nm) nm.style.display='none';
  G('abadge').style.display='none';
  G('usermgmt').style.display='none';

  ['bl-ao','rb-ao','bs-ao'].forEach(id=>{ const el=G(id); if(el) el.style.display=''; });
  const gg=G('global-settings-grid'); if(gg) gg.style.display='none';
  const gl=G('global-settings-label'); if(gl) gl.style.display='none';
  // Switch back to gallery tab manually
  document.querySelectorAll('.ntab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  const gt=document.querySelector('.ntab[data-tab="gallery"]');
  if(gt){gt.classList.add('active');const gp=document.getElementById('tab-gallery');if(gp)gp.classList.add('active');}
  showLogin();
};



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// closePdfViewer/printPdfViewer meldet js/12-pdfviewer.js selbst an — der
// Handler gehört zu dem Modul, das ihn umsetzt (Nachtrag 130).
registerActions({
  gibToggle,
  openLogViewer,
  showPanel,
});

/**
 * Setter für _monitorTimer — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_monitorTimer(v) { _monitorTimer = v; }

/**
 * Setter für CURRENCY — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_CURRENCY(v) { CURRENCY = v; }

/**
 * Setter für _settingsCache — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_settingsCache(v) { _settingsCache = v; }
