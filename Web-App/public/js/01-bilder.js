import { html, sichereUrl, ungeprueft } from './00-escapen.js';
import { ico, setzeHtml } from './01-dom.js';

// Bildadressen und Platzhalter. Fremde Bilder gehen nur über den Proxy des Servers; was nicht lädt,
// zeigt den Platzhalter seiner Art statt des Browsersymbols.

/**
 * Ein Vorschaubild aus einer Vorlage. Lädt es nicht, setzt 11-actions.js den
 * Platzhalter seiner Art (`ph`) an seine Stelle — dasselbe Bild wie für einen
 * Eintrag ganz ohne Bild, statt des Browser-Symbols für kaputte Bilder.
 * @param {{ src: string, alt: string, ph?: 'set'|'teil'|'figur', klasse?: string,
 *           orig?: string, stil?: string, fade?: boolean, extra?: string }} o
 */
export function bildTag(o) {
  return html`${html`<img src="${sichereUrl(o.src)}" alt="${o.alt || ''}"${o.klasse ? html` class="${o.klasse}"` : ''}`}${html` loading="lazy" decoding="async" data-onerror="platzhalter" data-ph="${o.ph || 'set'}"`}${html`${o.orig ? html` data-orig="${sichereUrl(o.orig)}"` : ''}${o.fade ? html` data-fade="1"` : ''}`}${html`${o.stil ? html` data-stil="${o.stil}"` : ''}${o.extra ? html`${' '}${ungeprueft(o.extra)}` : ''} />`}`;
}

/**
 * Der Platzhalter einer Art: das Set-Bild oder das Symbol in einer getönten Fläche.
 * @param {string} art
 */
export function platzhalterInhalt(art) {
  // Dasselbe dezente Symbol wie bei Teilen und Figuren; das rote Logo füllte
  // ohne Bilder jede Karte gleich.
  // Sets nehmen die Datei: Sie sieht in jedem Design gleich aus (UI-Prüfung 6, M3).
  if (art === 'set') return html`<img src="/assets/set-placeholder.svg" alt="" aria-hidden="true">`;
  return ico(art === 'figur' ? 'figur' : 'teil');
}

/**
 * Zeigt den Platzhalter, solange ein Bild noch einmal versucht wird; das Bild
 * bleibt verborgen daneben und ersetzt ihn, sobald es doch lädt. Ohne das
 * stand während des zweiten Versuchs das Symbol des Browsers in der Kachel.
 * @param {HTMLImageElement} img
 */
export function bildVorlaeufig(img) {
  if (img.previousElementSibling?.classList.contains('bild-ph-vorlaeufig')) return;
  bildPlatzhalter(img, true);
  img.hidden = true; img.style.display = 'none';
  // Verborgen lädt ein lazy-Bild nie; der zweite Versuch soll aber laufen.
  img.setAttribute('loading', 'eager');
}

/**
 * Das Bild hat doch geladen: vorläufigen Platzhalter entfernen.
 * @param {HTMLImageElement} img
 */
export function bildGeladen(img) {
  const ph = img.previousElementSibling;
  if (!ph?.classList.contains('bild-ph-vorlaeufig')) return;
  ph.remove(); img.hidden = false; img.style.display = '';
}

/**
 * Ersetzt ein Bild, das nicht lädt, durch seinen Platzhalter in derselben Grösse.
 * @param {HTMLImageElement} img
 */
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
  if (!img.closest('.sci')) for (const k of /** @type {const} */ (['width', 'height', 'borderRadius', 'margin'])) if (cs[k] && cs[k] !== 'auto') ph.style[k] = cs[k];
  setzeHtml(ph, platzhalterInhalt(img.dataset.ph ?? ''));
  if (vorlaeufig) { ph.classList.add('bild-ph-vorlaeufig'); img.before(ph); return; }
  img.replaceWith(ph);
}

/**
 * Der Bild-Proxy liegt unter /api/v1. Ältere image_url aus der Datenbank tragen noch die alte Adresse;
 * erkannt werden beide, gebaut wird nur die neue.
 * Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#img-proxy
 */
const IMG_PROXY = '/api/v1/img-proxy';

const IMG_PROXY_ALT = '/api/img-proxy';

/**
 * Traegt diese Adresse eine der beiden Proxy-Formen?
 * @param {string} src
 */
function istProxyPfad(src) {
  return src.startsWith(IMG_PROXY) || src.startsWith(IMG_PROXY_ALT);
}

/**
 * Adressen auf den eigenen Server auf ihren Pfad kürzen: imgEl.src liefert die absolute Adresse, und
 * der Proxy lehnt sich selbst als Ziel zu Recht ab (offene Weiterleitung). Ohne das brach der Zoom mit
 * 403.
 * Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#stripownorigin
 * @param {string} src
 * @returns {string} Pfad, wenn die Adresse auf den eigenen Ursprung zeigt, sonst unverändert
 */
function stripOwnOrigin(src) {
  if (typeof location === 'undefined' || !location.origin) return src;
  if (src.startsWith(location.origin + '/')) return src.slice(location.origin.length);
  return src;
}

/**
 * Die Adresse, unter der ein Bild geladen wird. `thumb` wirkt nur bei Bildern
 * über den Proxy; bei lokalen Dateien entscheidet der Server (image_local
 * ist schon die richtige Adresse, siehe thumbUrl()).
 * @param {string | null | undefined} src
 * @param {boolean | 'nur'} [thumb]  'nur': nur die verkleinerte Fassung, nie das Original nachladen
 */
export function imgUrl(src, thumb) {
  if (!src) return '';
  src = stripOwnOrigin(src);

  // Lokale Datei oder schon über den Proxy: unverändert. Fremde Adressen lädt der Browser nie direkt —
  // nur der Proxy setzt die Kopfzeilen gegen den Hotlink-Schutz und hält den Cache.
  // Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#if-2
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
    // Vorschauen entstehen im Proxy. `thumb` 'nur' nutzt eine vorhandene, rechnet aber keine neue: für den
    // Katalog mit 25 000 fremden Sets, an denen man vorbeiscrollt. Der eigene Bestand bekommt die Vorschau
    // (true).
    // Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#tp
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
 * @param {string | null | undefined} src
 * @returns {string}
 */
export function fullUrl(src) {
  if (!src) return '';
  src = stripOwnOrigin(src);
  if (istProxyPfad(src)) return src.replace(/&thumb=1\b/, '').replace(/&gen=0\b/, '');
  // Absolute Adresse (CDN) auch hier über den Proxy — vorher wurde sie
  // unverändert zurückgegeben, sodass Detailansicht und Zoom direkt beim CDN
  // luden. Siehe die Begründung in imgUrl().
  if (/^https?:\/\//.test(src)) return IMG_PROXY + '?url=' + encodeURIComponent(src);
  return src.replace(/_thumb(\.[^.?]+)(\?|$)/, '$1$2');
}

/**
 * Lokale Bildadressen bleiben, wie der Server sie liefert: Er weiss, ob es die Vorschau gibt. Eine
 * selbst gebaute _thumb-Adresse lud Bilder, die nicht existierten, auch nach dem Neuladen nicht
 * (gleich in der App).
 * Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#thumburl
 * @template {string | null | undefined} T
 * @param {T} src
 * @returns {T}
 */
export function thumbUrl(src) {
  return src;
}

// Lazy image loading with IntersectionObserver and fade-in
/**
 * Blendet Bilder beim Sichtbarwerden ein und markiert schon geladene sofort: Nach innerHTML starten
 * alle <img> bei opacity 0, und bis der Beobachter antwortet, stand sonst eine kurz weisse Kachelwand
 * da.
 * Ausführlich: docs/begruendungen/public/js/01-bilder.js.md#observelazyimages
 * @param {ParentNode} [root]
 */
export function observeLazyImages(root) {
  const imgs = /** @type {NodeListOf<HTMLImageElement>} */ ((root||document).querySelectorAll('img[loading=lazy]:not(.observed)'));
  if(!imgs.length) return;
  // Synchron, VOR dem nächsten Paint
  imgs.forEach(img => { if(img.complete && img.naturalWidth > 0) img.classList.add('loaded'); });
  const beobachter = window._imgObserver ??= new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if(e.isIntersecting){
        const img = /** @type {HTMLImageElement} */ (e.target);
        if(img.complete) img.classList.add('loaded');
        img.addEventListener('load', ()=>img.classList.add('loaded'), {once:true});
        obs.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  imgs.forEach(img => { img.classList.add('observed'); beobachter.observe(img); });
}
