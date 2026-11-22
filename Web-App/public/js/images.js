import { html, safeUrl, rawHtml } from './escaping.js';
import { ico, setHtml } from './dom.js';

// Image addresses and placeholders. Foreign images only go via the server's proxy; whatever does not load shows the
// placeholder of its kind instead of the browser icon.

/**
 * A preview image from a template. If it does not load, actions.js puts the placeholder of its kind (`ph`) in
 * its place — the same image as for an entry without any image, instead of the browser icon for broken
 * images.
 * @param {{ src: string, alt: string, ph?: 'set'|'teil'|'figur', class?: string,
 *           orig?: string, style?: string, fade?: boolean, extra?: string }} o
 */
export function imageTag(o) {
  return html`${html`<img src="${safeUrl(o.src)}" alt="${o.alt || ''}"${o.class ? html` class="${o.class}"` : ''}`}${html` loading="lazy" decoding="async" data-onerror="placeholder" data-ph="${o.ph || 'set'}"`}${html`${o.orig ? html` data-orig="${safeUrl(o.orig)}"` : ''}${o.fade ? html` data-fade="1"` : ''}`}${html`${o.style ? html` data-style="${o.style}"` : ''}${o.extra ? html`${' '}${rawHtml(o.extra)}` : ''} />`}`;
}

/**
 * The placeholder of a kind: the set image or the icon in a tinted area.
 * @param {string} kind
 */
export function placeholderContent(kind) {
  // The same subtle icon as for parts and figures; the red logo filled every card the same way without images.
  // Sets take the file: it looks the same in every theme (UI check 6, M3).
  if (kind === 'set') return html`<img src="/assets/set-placeholder.svg" alt="" aria-hidden="true">`;
  return ico(kind === 'figur' ? 'minifig' : 'part');
}

/**
 * Shows the placeholder while an image is retried; the image stays hidden next to it and
 * replaces it as soon as it does load. Without that, the browser's icon stood in the tile during the second attempt.
 * @param {HTMLImageElement} img
 */
export function imageProvisional(img) {
  if (img.previousElementSibling?.classList.contains('image-ph-provisional')) return;
  imagePlaceholder(img, true);
  img.hidden = true;
  img.style.display = 'none';
  // Hidden, a lazy image never loads; but the second attempt should run.
  img.setAttribute('loading', 'eager');
}

/**
 * The image did load after all: remove the temporary placeholder.
 * @param {HTMLImageElement} img
 */
export function imageLoaded(img) {
  const ph = img.previousElementSibling;
  if (!ph?.classList.contains('image-ph-provisional')) return;
  ph.remove();
  img.hidden = false;
  img.style.display = '';
}

/**
 * Replaces an image that does not load with its placeholder of the same size.
 * @param {HTMLImageElement} img
 */
export function imagePlaceholder(img, provisional = false) {
  const alt = img.previousElementSibling;
  if (!provisional && alt?.classList.contains('image-ph-provisional')) {
    alt.classList.remove('image-ph-provisional');
    img.remove();
    return;
  }
  const ph = document.createElement('span');
  ph.className = ('image-ph ' + (img.getAttribute('class') || '').replace(/\bloaded\b/, '')).trim();
  ph.setAttribute('role', 'img');
  ph.setAttribute('aria-label', img.getAttribute('alt') || '');
  if (!img.getAttribute('alt')) ph.setAttribute('aria-hidden', 'true');
  const cs = getComputedStyle(img);
  // In the tile the placeholder fills the image area; a broken image only measures its icon.
  if (!img.closest('.sci'))
    for (const k of /** @type {const} */ (['width', 'height', 'borderRadius', 'margin']))
      if (cs[k] && cs[k] !== 'auto') ph.style[k] = cs[k];
  setHtml(ph, placeholderContent(img.dataset.ph ?? ''));
  if (provisional) {
    ph.classList.add('image-ph-provisional');
    img.before(ph);
    return;
  }
  img.replaceWith(ph);
}

/**
 * The image proxy stays under /api/v1 (stored image_url values point there). Older values still carry
 * both are recognized, only the new one is built.
 */
const IMG_PROXY = '/api/v1/img-proxy';

const IMG_PROXY_LEGACY = '/api/img-proxy';

/**
 * Does this address carry one of the two proxy forms?
 * @param {string} src
 */
function isProxyPath(src) {
  return src.startsWith(IMG_PROXY) || src.startsWith(IMG_PROXY_LEGACY);
}

/**
 * Shorten addresses pointing to the own server to their path: imgEl.src delivers the absolute address, and the
 * proxy rightly rejects itself as a target (open redirect). Without that, the zoom broke with
 * 403.
 * @param {string} src
 * @returns {string} path if the address points to the own origin, otherwise unchanged
 */
function stripOwnOrigin(src) {
  if (typeof location === 'undefined' || !location.origin) return src;
  if (src.startsWith(location.origin + '/')) return src.slice(location.origin.length);
  return src;
}

export const PLACEHOLDER_SET = '/assets/set-placeholder.svg';

/**
 * Reassign a fixed dialog image. The flags of the error handling (actions.js) are attached to the element and
 * would stay from the last opening: the second time there was then no placeholder, only a broken image.
 * @param {HTMLElement} el @param {string} src @param {string} [orig]
 */
export function setDialogImage(el, src, orig) {
  const img = /** @type {HTMLImageElement} */ (el);
  delete img.dataset.retried;
  delete img.dataset.origTried;
  delete img.dataset.fallbackDone;
  if (orig !== undefined) img.dataset.orig = orig;
  img.src = src;
  zoomStatus(img);
}

/**
 * A placeholder enlarges nothing: it is then neither a button nor a tab stop.
 * @param {HTMLImageElement} img
 */
export function zoomStatus(img) {
  if (!img.classList.contains('zoombar')) return;
  const empty = !img.getAttribute('src') || img.getAttribute('src') === PLACEHOLDER_SET;
  // The dialog images lie in a real button (keyboard, screen reader); disabled it is no tab stop.
  const button = img.parentElement;
  if (button instanceof HTMLButtonElement && button.classList.contains('zoom-button')) {
    button.disabled = empty;
    button.toggleAttribute('aria-hidden', empty);
    if (empty) button.removeAttribute('data-click');
    else button.dataset.click = button.dataset.zoomClick || '';
    return;
  }
  // The click rests too: a mouse click area without a tab stop would only be there for the mouse.
  if (empty) {
    img.removeAttribute('role');
    img.tabIndex = -1;
    img.setAttribute('aria-hidden', 'true');
    if (img.dataset.click) {
      img.dataset.zoomClick = img.dataset.click;
      delete img.dataset.click;
    }
  } else {
    img.setAttribute('role', 'button');
    img.tabIndex = 0;
    img.removeAttribute('aria-hidden');
    if (img.dataset.zoomClick && !img.dataset.click) img.dataset.click = img.dataset.zoomClick;
  }
}

/**
 * The address under which an image is loaded. `thumb` only has an effect for images via the proxy; for local
 * files the server decides (image_local is already the right address, see thumbUrl()).
 * @param {string | null | undefined} src
 * @param {boolean | 'only'} [thumb]  'only': only the reduced version, never load the original afterwards
 */
export function imgUrl(src, thumb) {
  if (!src) return '';
  src = stripOwnOrigin(src);

  // Local file or already via the proxy: unchanged. The browser never loads foreign addresses directly — only
  // the proxy sets the headers against hotlink protection and keeps the cache.
  if (src.startsWith('/data/') || src.startsWith('/images/') || isProxyPath(src)) {
    return src;
  }
  // Other relative paths (e.g. /assets/…) unchanged.
  if (src.startsWith('/')) return src;

  // Everything absolute goes via the proxy — regardless of the host. Which hosts are allowed is decided
  // exclusively by the server (ALLOWED_IMAGE_HOSTS in src/infra/foreignAddresses.ts); a second, diverging
  // allowlist test in the client would only be another place one forgets to maintain.
  if (/^https?:\/\//.test(src)) {
    // Previews are created in the proxy. `thumb` 'only' uses an existing one but computes no new one: for the
    // catalog with 25,000 foreign sets one scrolls past. The own inventory gets the preview
    // (true).
    const tp = thumb === 'only' ? '&thumb=1&gen=0' : thumb ? '&thumb=1' : '';
    return IMG_PROXY + '?url=' + encodeURIComponent(src) + tp;
  }
  return src;
}

/**
 * Counterpart to thumbUrl(): delivers the full resolution.
 *
 * Needed because some sets have image_local pointing directly at the _thumb file (the server may have stored it
 * like that) — and because the detail view and zoom should show the large version, not the tile size.
 * @param {string | null | undefined} src
 * @returns {string}
 */
export function fullUrl(src) {
  if (!src) return '';
  src = stripOwnOrigin(src);
  if (isProxyPath(src)) return src.replace(/&thumb=1\b/, '').replace(/&gen=0\b/, '');
  // Absolute address (CDN) via the proxy here too — before it was returned unchanged, so that
  // detail view and zoom loaded directly from the CDN. See the reasoning in imgUrl().
  if (/^https?:\/\//.test(src)) return IMG_PROXY + '?url=' + encodeURIComponent(src);
  return src.replace(/_thumb(\.[^.?]+)(\?|$)/, '$1$2');
}

/**
 * Local image addresses stay as the server delivers them: it knows whether the preview exists. A self-built
 * _thumb address loaded images that did not exist, not even after reloading (same in the app).
 * @template {string | null | undefined} T
 * @param {T} src
 * @returns {T}
 */
export function thumbUrl(src) {
  return src;
}

/** One for all images of the page. @type {IntersectionObserver | null} */
let imageObserver = null;

/**
 * Fades images in when they become visible and marks already loaded ones immediately: after innerHTML all
 * <img> start at opacity 0, and until the observer answers, a briefly white tile wall would otherwise state there.
 * @param {ParentNode} [root]
 */
export function observeLazyImages(root) {
  const imgs = /** @type {NodeListOf<HTMLImageElement>} */ (
    (root || document).querySelectorAll('img[loading=lazy]:not(.observed)')
  );
  if (!imgs.length) return;
  // Synchronous, BEFORE the next paint
  imgs.forEach(img => {
    if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
  });
  imageObserver ??= new IntersectionObserver(
    (entries, obs) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const img = /** @type {HTMLImageElement} */ (e.target);
          if (img.complete) img.classList.add('loaded');
          img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
          obs.unobserve(img);
        }
      });
    },
    { rootMargin: '200px' },
  );
  const observer = imageObserver;
  imgs.forEach(img => {
    img.classList.add('observed');
    observer.observe(img);
  });
}
