// The CSP forbids style attributes, so injected markup cannot reshape the page. Styles therefore
// sit as data-style and only apply if they occur in the source (list from
// scripts/build-frontend.js).

/* global __ALLOWED_STYLES__ */
const ALLOWED = new Set(typeof __ALLOWED_STYLES__ === 'undefined' ? [] : __ALLOWED_STYLES__);

// Values that are only known at runtime come through their own attributes with a fixed shape: a
// color, a number. They cannot set more than this one property each.
const COLOR = /^(#[0-9A-Fa-f]{6}|var\(--[a-z0-9-]+\))$/;
const NUMBER = /^\d{1,5}(\.\d{1,3})?$/;
/** @type {Array<[string, (el: HTMLElement, v: string) => void]>} */
const RUNTIME_ATTRS = [
  [
    'data-color-hex',
    (el, v) => {
      if (COLOR.test(v)) el.style.background = v;
    },
  ],
  [
    'data-width',
    (el, v) => {
      if (NUMBER.test(v)) el.style.width = Math.min(100, Number(v)) + '%';
    },
  ],
  [
    'data-width-px',
    (el, v) => {
      if (NUMBER.test(v)) el.style.width = v + 'px';
    },
  ],
  [
    'data-height-px',
    (el, v) => {
      if (NUMBER.test(v)) el.style.height = v + 'px';
    },
  ],
  [
    'data-fan',
    (el, v) => {
      if (/^\d{1,2}$/.test(v)) el.style.setProperty('--fan-hue', `var(--fan-${v})`);
    },
  ],
];
const SELECTOR = '[data-style],' + RUNTIME_ATTRS.map(([a]) => `[${a}]`).join(',');

/**
 * Apply every data-style and runtime value under `root` (inclusive).
 * @param {HTMLElement} root
 */
export function applyStyles(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const els = /** @type {HTMLElement[]} */ ([...root.querySelectorAll(SELECTOR)]);
  if (root.matches?.(SELECTOR)) els.unshift(root);
  for (const el of els) {
    const style = el.getAttribute('data-style');
    if (style !== null) {
      if (ALLOWED.has(style)) el.style.cssText = style;
      else console.warn('[styles] not allow-listed:', style);
      el.removeAttribute('data-style');
    }
    for (const [attr, apply] of RUNTIME_ATTRS) {
      const v = el.getAttribute(attr);
      if (v !== null) {
        apply(el, v);
        el.removeAttribute(attr);
      }
    }
  }
}

// Wrap innerHTML & co. so the style lands in the same step as the markup: code that right
// afterwards flips el.style.display sees the starting value and does not get overwritten later.
/**
 * @param {object} proto
 * @param {string} name
 * @param {(el: HTMLElement, parent: HTMLElement, arg0?: unknown) => void} after
 */
function wrap(proto, name, after) {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  if (!d) return;
  if (d.set) {
    Object.defineProperty(proto, name, {
      ...d,
      set(v) {
        const p = this.parentNode;
        d.set?.call(this, v);
        after(this, p);
      },
    });
  } else if (typeof d.value === 'function') {
    const f = d.value;
    Object.defineProperty(proto, name, {
      ...d,
      value(/** @type {unknown[]} */ ...a) {
        const p = this.parentNode;
        const r = f.apply(this, a);
        after(this, p, a[0]);
        return r;
      },
    });
  }
}
if (typeof Element !== 'undefined') {
  wrap(Element.prototype, 'innerHTML', (/** @type {HTMLElement} */ el) => applyStyles(el));
  // outerHTML replaces the element itself; the new nodes hang off the parent.
  wrap(Element.prototype, 'outerHTML', (/** @type {HTMLElement} */ _el, p) => applyStyles(p));
  wrap(Element.prototype, 'insertAdjacentHTML', (/** @type {HTMLElement} */ el, p, where) =>
    applyStyles(/^(beforebegin|afterend)$/i.test(String(where)) ? p : el),
  );
  if (typeof document !== 'undefined') applyStyles(document.documentElement);
}
