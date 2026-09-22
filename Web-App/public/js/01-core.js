import { registerActions } from './00-registry.js';
import { resetScopeModes } from './14-scope.js';
import { I18N, LANG, applyLang, locale, t , setLangValue, tRaw} from '../i18n.js';
import { setAllSets, bindTabs, loadGallery, loadStats } from './02-gallery.js';
import { plInit, resetPartsList } from './08-init.js';
import { gibCheckOnLoad, gibZuruecksetzen } from './01-fortschritt.js';

// ═══ Escaping, Werkzeuge, api(), i18n-Glue, Auth & Panels, Login/Logout ═══
//
// Was NICHT (mehr) hier steht, obwohl es hier stand:
//   Kontofilter                    → js/14-scope.js      (Nachtrag 136)
//   eigener Scrollbalken           → js/15-scrollbar.js  (Nachtrag 136)
//   PDF-Betrachter                 → js/12-pdfviewer.js  (Nachtrag 130)
//   CSV-Import-Fortschrittsbalken  → js/01-fortschritt.js (Nachtrag 141)
//   Überwachung und Protokollfenster → js/01-monitor.js   (Nachtrag 141)
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
//   Farbwert in style=""                         → escHex()

/** HTML-Escape für Textinhalte und doppelt-gequotete Attributwerte. */
/**
 * Wie kurz ein Passwort hoechstens sein darf — dieselbe Zahl wie im Server
 * (PASSWORT_MIN_ZEICHEN in utils/auth.ts) und in der App.
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
  // Die BREITE einfrieren, bevor die Beschriftung weicht.
  //
  // Marcos Video vom 22.09. zeigt es im Reiter „Teileliste": Beim Druck auf
  // „Bereits vorhandene Teile eintragen“ zuckt die ganze Zeile kurz zusammen
  // und springt zurück. Grund ist dieser Helfer — „…“ ist rund 200 px schmaler
  // als die Beschriftung, und in einer flex-Zeile rutscht alles rechts daneben
  // mit. Gemessen an den Einzelbildern: 7 Bilder bei 30 B/s, also gut 0,2 s.
  //
  // offsetWidth ist die AUSSENBREITE inklusive Rahmen und Innenabstand. Als
  // min-width gesetzt hält sie die Zeile still, ohne den Knopf zu verbreitern:
  // Ist der Wartetext ausnahmsweise länger (die PDF-Erzeugung gibt eigene mit),
  // darf der Knopf weiter wachsen.
  //
  // 0 bedeutet „der Knopf wird gerade nicht angezeigt“ (display:none, oder
  // jsdom ohne Layout). Dann gibt es nichts einzufrieren.
  const breite = btn.offsetWidth;
  const minVorher = btn.style.minWidth;
  if (breite) btn.style.minWidth = breite + 'px';
  btn.disabled = true;
  btn.textContent = laeuft;
  return (text) => {
    btn.disabled = false;
    btn.textContent = text ?? vorher;
    // Die eigene Vorgabe zurückgeben, nicht blind leeren: Ein Knopf, der von
    // sich aus eine min-width trägt, behält sie.
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
 * Konstanten in utils/images.ts.
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
/**
 * Ein GELDBETRAG in der Waehrung des Nutzers.
 *
 * ── Warum der Rueckfall nicht mehr 'EUR' ist (Nachtrag 164) ─────────────────
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
  // Reihenfolge: zu kurz VOR ungleich — dieselbe wie in der App
  // (LoginScreen.kt). Deren Kommentar behauptete schon vorher „dieselben drei
  // Pruefungen wie im Web-Formular, und in derselben Reihenfolge"; wahr war
  // daran bis hierher weder das eine noch das andere, weil die Webapp die
  // Laenge gar nicht prueft.
  if(passwortZuKurz(p)){ err.textContent=passwortZuKurzText(); err.style.display='block'; return; }
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
  if(passwortZuKurz(p)){ err.textContent=passwortZuKurzText(); err.style.display='block'; return; }
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
  // ── Keine zweite Liste hier (Nachtrag 168) ────────────────────────────────
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
function showLogin(){
  // Der Fortschrittsbalken gehört js/01-fortschritt.js — dort steht auch, was
  // „zurücksetzen“ für ihn bedeutet (Anzeige aus, beide Abfragen gestoppt,
  // Protokoll geleert). Hier stand früher sein Innenleben ausgeschrieben.
  gibZuruecksetzen();
  sessionStorage.removeItem('webToken');
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
  ['btn-pl-pdf','btn-pl-bl','pl-bl-condition','pl-bestand-zeile'].forEach(id=>{const el=G(id);if(el)el.style.display='none';});
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



function showApp(){ bindTabs(); plInit(); setTimeout(()=>{ gibCheckOnLoad(); }, 1000);
  G('login-screen').style.display='none'; G('app').style.display='block';
  G('ubadge').textContent=ME.username;
  initDefaultCondition();
  // Kontoauswahl beim Erfassen — bleibt verborgen, wenn es nichts zu wählen
  // gibt. Import aus 02-gallery.js gäbe einen Zyklus (dort wird api() aus
  // dieser Datei geholt), deshalb der späte dynamische Import.
  import('./02-gallery.js').then(m => m.loadHouseholdMembers?.()).catch(() => {});
  // Ausgeloeste Preisalarme seit dem letzten Besuch — das Gegenstueck zum
  // stuendlichen Abruf der Android-App. Begruendung bei zeigeOffeneAlarme()
  // in 07-admin.js; der spaete dynamische Import aus demselben Grund wie eine
  // Zeile darueber (07-admin.js holt api() aus dieser Datei).
  import('./07-admin.js').then(m => m.zeigeOffeneAlarme?.()).catch(() => {});
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
// gibToggle meldet js/01-fortschritt.js an, openLogViewer js/01-monitor.js,
// closePdfViewer/printPdfViewer js/12-pdfviewer.js — der Handler gehört zu dem
// Modul, das ihn umsetzt (Nachtrag 130).
registerActions({
  showPanel,
});

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
