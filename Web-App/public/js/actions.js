import { isTrusted, registerActions, resolveAction } from './registry.js';
import { bildPlatzhalter, imageProvisional, imageLoaded, fullUrl, zoomStand, PLACEHOLDER_SET } from './images.js';
import { G, atPhoneSwitch } from './dom.js';
import { setLang } from './account.js';
import { toast } from './messages.js';
import { tRaw } from '../i18n.js';
import { saveJobSchedule } from './monitor.js';
import { openPdfViewer } from './pdfviewer.js';
import { allMinifigs, deleteManualFig, renderFigs, renderManualFigsTable, updateManualFig } from './minifigs.js';
import { merkpostenLoeschen } from './wanted.js';
import { autosaveSet, closeImageLightbox, openImageLightbox } from './set-detail.js';
import { setQuantitiesField } from './detail-fields.js';
import { hideProgress } from './progress.js';
import { deleteManualPart } from './parts.js';

// A delegated dispatcher for data-click & co. instead of onclick in markup: that way the CSP needs no
// script-src 'unsafe-inline', and an overlooked XSS hole still runs into this line of defense.

(() => {
  /** Events caught via delegation on document. No mouseenter/mouseleave: hovering with the mouse is not
   * intent, and injected markup would trigger actions without a click. */
  const DELEGATED = ['click', 'change', 'input', 'blur', 'keydown'];

  /** blur doesn't bubble — needs capture. */
  const NEEDS_CAPTURE = new Set(['blur', 'error', 'load']);

  // Except for click, every event only accepts the handlers the markup actually uses for it;
  // test/aktionen-schutz.test.js checks this list against the markup.
  /** @type {Record<string, Set<string>>} */
  const ONLY = {
    change: new Set([
      'acqSave',
      'aendereAlarmSchwelle',
      'autosaveSet',
      'benenneLagerortUm',
      'gutscheinDateiGewaehlt',
      'gutscheinLandSpeichern',
      'importAlarmeCsv',
      'importConfig',
      'importFigsCsv',
      'importMerklisteCsv',
      'importPartsCsv',
      'ladeMerkliste',
      'lagerortGewaehlt',
      'manAcqSave',
      'manQtySave',
      'merkpostenInhaberGewaehlt',
      'onScopeChange',
      'onStorageChange',
      'plFuelleBestand',
      'renderFigsAll',
      'renderGallery',
      'saveJobMinutes',
      'saveJobTime',
      'saveRegEnabled',
      'setCatFilter',
      'setColorFilter',
      'setLangFromEl',
      'setzeDunkel',
      'setzeEigenesDesign',
      'speichereAlarm',
      'speichereAppDesign',
      'speichereCacheTtl',
      'speichereWaehrung',
      'speichereZustand',
      'speichereSetLagerort',
      'speichereStandardZustand',
      'speichereTeilFarbe',
      'speichereTeilLagerort',
      'startSetCsvImport',
      'updateColorDot',
      'uploadInstr',
      'waehrungPruefen',
      'wantedKorrekturFarbe',
      'wantedKorrekturNummer',
      'wantedKorrekturWert',
      'wantedXmlGewaehlt',
      'wechsleAlarmZustand',
    ]),
    input: new Set(['alarmGetippt', 'filterFigs', 'finSuchen']),
    blur: new Set(['acqSave', 'lagerortGetippt', 'manAcqSave', 'saveManualFigBl']),
    keydown: new Set(['blurOnEnter', 'lagerortTaste']),
  };

  // Delete, account, access, admin: only from elements our own code created (isTrusted), never from
  // injected markup.
  const DANGEROUS = new Set([
    'delSet',
    'delSetStop',
    'delInstr',
    'acqDelete',
    'manAcqDelete',
    'deleteManualFig',
    'deleteManualFigStop',
    'deleteManualPartStop',
    'merkpostenLoeschen',
    'merkpostenLoeschenStop',
    'merkpostenDetailLoeschen',
    'gutscheinLoeschen',
    'loescheAlarm',
    'loescheLagerort',
    'papierkorbEndgueltig',
    'papierkorbLeeren',
    'deleteBricksetQueueEntry',
    'revokeToken',
    'revokeOtherTokens',
    'passkeyHinzufuegen',
    'passkeyLoeschen',
    'qrKopplungBestaetigen',
    'qrKopplungAblehnen',
    'zfEinrichten',
    'zfNeueCodes',
    'zfAbschalten',
    'zfZuruecksetzen',
    'createHouseholdInvite',
    'redeemHouseholdInvite',
    'unlinkHousehold',
    'unlinkFromParent',
    'delUser',
    'kontoFreischalten',
    'toggleAdmin',
    'toggleAktiv',
    'openRpw',
    'saveRegEnabled',
    'importConfig',
    'auftragAbbrechen',
    'auftragsArtLeeren',
  ]);

  /**
   * @param {string} type
   */
  function attrFor(type) {
    return 'data-' + type;
  }

  /**
   * Resolve handler names through the registry: module functions don't live on window. resolveAction()
   * still falls back to window internally, for the log viewer, which runs as a classic script in its own
   * popup.
   * @param {string} name
   */
  function resolve(name) {
    return resolveAction(name);
  }

  /**
   * @param {string} type
   * @param {Event} ev
   */
  function handle(type, ev) {
    const el = /** @type {HTMLElement | null | undefined} */ (
      /** @type {Element | null} */ (ev.target)?.closest?.(`[${attrFor(type)}]`)
    );
    if (!el) return;
    const name = el.getAttribute(attrFor(type));
    if (name === null || (ONLY[type] && !ONLY[type].has(name)) || (DANGEROUS.has(name) && !isTrusted(el))) {
      console.warn('[actions] rejected:', type, name);
      return;
    }
    const fn = resolve(name);
    if (!fn) {
      console.warn('[actions] unknown handler:', name);
      return;
    }

    // Arguments: data-arg, data-arg2, data-arg3 … in that order. data-val="1" appends the field's current
    // value — covers the many handlers that used to read this.value.
    const args = [];
    // data-self="1": element as the first argument. Several existing handlers used to expect `this`
    // explicitly (e.g. triggerCsvSync(this)).
    if (el.dataset.self === '1') args.push(el);
    for (const key of ['data-arg', 'data-arg2', 'data-arg3', 'data-arg4', 'data-arg5', 'data-arg6']) {
      if (!el.hasAttribute(key)) break;
      args.push(el.getAttribute(key));
    }
    if (el.dataset.val === '1') args.push(/** @type {HTMLInputElement} */ (el).value);
    args.push(ev);
    try {
      fn.apply(el, args);
    } catch (e) {
      console.error('[actions]', name, e);
    }
  }

  for (const type of DELEGATED) {
    document.addEventListener(type, ev => handle(type, ev), NEEDS_CAPTURE.has(type));
  }

  // Cards and rows with data-click are not buttons; with tabindex and this block the keyboard operates
  // them like one (Enter, and Space for role=button).
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (
      !(el instanceof HTMLElement) ||
      NATIVE.has(el.tagName) ||
      !el.hasAttribute?.('data-click') ||
      !el.hasAttribute('tabindex')
    )
      return;
    // The card's delete cross is a mouse shortcut (aria-hidden, no button allowed inside the card); Delete
    // is its keyboard path.
    const cross =
      ev.key === 'Delete' && el.matches('[aria-keyshortcuts~="Delete"]')
        ? el.querySelector(':scope > .ca > .delbtn')
        : null;
    // Only disabled when the button itself is missing (offline); without hovering the corner is just empty.
    if (cross && getComputedStyle(cross).display !== 'none') {
      ev.preventDefault();
      /** @type {HTMLElement} */
      (cross).click();
      return;
    }
    const space = ev.key === ' ' && el.getAttribute('role') === 'button';
    if (ev.key !== 'Enter' && !space) return;
    ev.preventDefault();
    el.click();
  });

  // Login and password fields sit in a <form> so password managers save and fill reliably. It's never
  // actually submitted: a real submit would reload the page; instead the button from data-submit runs.
  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    ev.preventDefault();
    const id = form.getAttribute('data-submit');
    if (!id) return;
    const button = /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
    if (button && !button.disabled) button.click();
  });
  // With more than one text field and no submit button, the browser doesn't submit on Enter (hidden
  // fields count too). Then Enter here triggers the button named by `data-submit`.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.defaultPrevented) return;
    const field = ev.target;
    if (!(field instanceof HTMLInputElement) || /^(button|submit|reset|checkbox|radio|file|image)$/.test(field.type))
      return;
    const id = field.form?.getAttribute('data-submit');
    if (!id || field.form?.querySelector('[type="submit"]')) return;
    ev.preventDefault();
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
    if (button && !button.disabled) button.click();
  });

  // ── Images: error and load state ────────────────────────────────────────
  // error and load don't bubble, but can be caught on document in the capture phase. Replaces the twelve
  // onerror and four onload attributes in the tile templates.
  document.addEventListener(
    'error',
    ev => {
      const el = ev.target;
      if (!(el instanceof HTMLImageElement)) return;

      // Retry once before giving up: a single connection error (ETIMEDOUT at the CDN) otherwise left the
      // tile permanently empty even though the image was fine.
      if (!el.dataset.retried && el.src) {
        el.dataset.retried = '1';
        if (/** @type {HTMLImageElement} */ (el).dataset.ph) imageProvisional(el);
        const src = el.src;
        // removeAttribute instead of src='': an empty src points at the PAGE, and the browser would try to
        // load it as an image.
        setTimeout(() => {
          el.removeAttribute('src');
          el.src = src;
        }, 1000);
        return;
      }

      if (el.dataset.onerror === 'keep') {
        // The zoom (#lightbox-img) keeps the address: an empty overlay would look like a broken zoom, so
        // the console names the address.
        console.warn('[img] failed to load:', el.src);
        return;
      }
      const orig = el.dataset.orig;
      if (orig && !el.dataset.origVersucht && el.getAttribute('src') !== orig) {
        el.dataset.origVersucht = '1';
        el.src = orig;
        zoomStand(el);
        return;
      }
      if (el.dataset.fallbackDone) return;
      el.dataset.fallbackDone = '1';
      // Images from templates (bildTag) get their kind's placeholder; the fixed dialog images get the
      // set's, otherwise a broken-image icon would show up.
      if (el.dataset.ph) bildPlatzhalter(el);
      else if (el.classList.contains('zoombar')) {
        el.src = PLACEHOLDER_SET;
        zoomStand(el);
      } else {
        el.removeAttribute('src');
        el.classList.add('loaded');
      }
    },
    true,
  );

  // .loaded on every img[loading=lazy], not just on data-fade: styles.css fades out all lazy images, and
  // without the extra attribute they would otherwise stay invisible despite being loaded.
  /** @param {EventTarget | null} el */
  function markLoaded(el) {
    if (el instanceof HTMLImageElement && el.getAttribute('loading') === 'lazy') {
      el.classList.add('loaded');
    }
    const img = /** @type {HTMLImageElement} */ (el);
    if (img?.tagName === 'IMG' && img.hidden && img.dataset.ph) imageLoaded(img);
  }

  document.addEventListener('load', ev => markLoaded(ev.target), true);

  // Images served from the browser cache are already complete when inserted — their load event has
  // already fired and would never arrive.
  const imgObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) {
          if (node.complete) markLoaded(node);
          continue;
        }
        /** @type {NodeListOf<HTMLImageElement>} */ (node.querySelectorAll('img[loading=lazy]')).forEach(i => {
          if (i.complete) markLoaded(i);
        });
      }
    }
  });

  if (document.body) imgObserver.observe(document.body, { childList: true, subtree: true });
  else
    document.addEventListener('DOMContentLoaded', () =>
      imgObserver.observe(document.body, { childList: true, subtree: true }),
    );
})();

// ── Small helpers for handlers that used to be an expression in the attribute ──
// The dispatcher calls with `this` = the triggering element and the event as the last argument.

function closePwModal() {
  G('pw-modal')?.classList.remove('open');
}

function closeImportProgress() {
  hideProgress();
  const b = G('btn-close-import');
  if (b) b.style.display = 'none';
}

/**
 * @param {Event} ev
 * @this {HTMLElement}
 */
function lightboxBackdrop(ev) {
  if (ev && ev.target === this) closeImageLightbox();
}

/**
 *
 * Prefers data-orig over this.src: since the switch to thumbnails the tiles show a shrunk version, which
 * would look blurry in the zoom. data-orig carries the full resolution.
 * @this {HTMLElement}
 */
function openImageLightboxFromEl() {
  // Called from the image itself or from the button around a dialog image.
  const img = this instanceof HTMLImageElement ? this : this.querySelector('img');
  if (!img) return;
  const src = img.dataset.orig && img.dataset.orig !== '/assets/set-placeholder.svg' ? img.dataset.orig : img.src;
  // The dialog's title names what the image shows (set, part, figure), with a subtitle carrying the number.
  const dialog = this.closest('.ovl');
  const name = [
    dialog?.querySelector('.mtit')?.textContent,
    dialog?.querySelector('.muntertit, [id$="-sub"]')?.textContent,
  ]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join(' – ');
  openImageLightbox(typeof fullUrl === 'function' ? fullUrl(src) : src, name);
}

/** @this {HTMLSelectElement} */
function setLangFromEl() {
  setLang(this.value);
}
/** Appearance per device — the logic lives in theme-boot.js. @this {HTMLSelectElement} */
function setzeDunkel() {
  window.__bimDunkel?.(this.value);
}

/**
 * The figures tab's view switch applies to both lists: it sits above both, so it also switches the
 * manually recorded figures.
 */
function renderFigsAll() {
  renderFigs(allMinifigs());
  renderManualFigsTable();
}
atPhoneSwitch(() => {
  if (G('figs-view')?.value === 'table') renderFigsAll();
});

// ── Wrappers for handlers that used to be an expression in the attribute ────
// All get `this` = the triggering element and the event as the last argument (see the dispatcher above).

/**
 * @param {Event | undefined} ev
 */
export function stopEvent(ev) {
  ev?.stopPropagation();
}

/**
 * @param {KeyboardEvent | undefined} ev
 * @this {HTMLElement}
 */
export function blurOnEnter(ev) {
  if (ev?.key === 'Enter') this.blur();
}

export function clickJobTrigger() {
  document.getElementById('btn-job-trigger')?.click();
}

/**
 * @param {string} k
 * @this {HTMLInputElement}
 */
export function saveJobTime(k) {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(this.value);
  const valid = !!m && +m[1] < 24 && +m[2] < 60;
  this.setAttribute('aria-invalid', String(!valid));
  if (!valid) {
    toast(tRaw('monitor.sched.ungueltig'), 'error');
    return;
  }
  this.value = m[1].padStart(2, '0') + ':' + m[2];
  saveJobSchedule(k, { time: this.value }, this);
}

/**
 * @param {string} k
 * @this {HTMLInputElement}
 */
export function saveJobMinutes(k) {
  saveJobSchedule(k, { minutes: Number(this.value) }, this);
}

// owner: the card's owner. Without it the server would write into the caller's row instead of the one
// shown — see openManDetail.
/**
 * @param {string} id
 * @param {string} owner
 * @this {HTMLInputElement}
 */
export function saveManualFigBl(id, owner) {
  updateManualFig(id, { bl_fig_number: this.value.trim() || null }, owner);
}

/**
 * Deletion from a tile, with stopPropagation: the tile itself has a data-click, and without stopping it
 * the trash would also open the dialog behind the delete confirmation.
 * @param {string} n
 * @param {string} owner
 * @param {Event | undefined} ev
 */
export function deleteManualFigStop(n, owner, ev) {
  ev?.stopPropagation();
  deleteManualFig(n, owner);
}

/**
 * @param {string} partNumber
 * @param {string} colorId Arrives as a string from data-arg2
 * @param {Event} ev
 * @param {string} owner
 */
export function deleteManualPartStop(partNumber, colorId, owner, ev) {
  ev?.stopPropagation();
  deleteManualPart(partNumber, parseInt(colorId, 10) || 0, owner);
}

/**
 * Delete a wanted item from its row.
 *
 * Since 24.09 the row opens the detail view across its WHOLE area — back then because it no longer had a
 * button. Now it has one again, and that's exactly why it needs the same stop-wrapped form as the tiles
 * next to it.
 * @param {string} arg
 * @param {Event | undefined} ev
 */
export function merkpostenLoeschenStop(arg, ev) {
  ev?.stopPropagation();
  merkpostenLoeschen(arg);
}

/**
 * @param {string} href
 * @param {string} desc
 * @param {Event | undefined} ev
 */
export function openPdfViewerLink(href, desc, ev) {
  ev?.preventDefault();
  openPdfViewer(href, desc || '');
}

export function mQtyDec() {
  const n = parseInt(G('m-qty').value || '1', 10);
  if (n <= 1) return;
  setQuantitiesField(n - 1);
  autosaveSet();
}

export function mQtyInc() {
  setQuantitiesField(parseInt(G('m-qty').value || '1', 10) + 1);
  autosaveSet();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
// Names below are registry-exposed (data-click/data-change in index.html) — kept unchanged.
registerActions({
  blurOnEnter,
  clickJobTrigger,
  closeImportProgress,
  closePwModal,
  deleteManualFigStop,
  deleteManualPartStop,
  merkpostenLoeschenStop,
  lightboxBackdrop,
  mQtyDec,
  mQtyInc,
  openImageLightboxFromEl,
  openPdfViewerLink,
  renderFigsAll,
  saveJobMinutes,
  saveJobTime,
  saveManualFigBl,
  setLangFromEl,
  setzeDunkel,
  stopEvent,
});
