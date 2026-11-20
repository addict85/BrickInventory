import { tRaw } from '../i18n.js';
import { toast } from './messages.js';

/**
 * A safety net for errors nobody handles: api() no longer throws, but a programming mistake in a
 * callback otherwise only ended up in the console — you click, nothing happens, and nobody finds out.
 */
let _lastErrorAt = 0;
/** @param {string} source @param {unknown} error */
function reportUnexpected(source, error) {
  console.error(`[${source}]`, error);
  const now = Date.now();
  if (now - _lastErrorAt < 5000) return;
  _lastErrorAt = now;
  // tRaw instead of t: the result goes through toast() into textContent — t() escapes the inserted
  // values, and that escaping would then show up LITERALLY (see frontend-escaping.test.js).
  toast(tRaw('api.unexpected'), 'error');
}

/**
 * Does the error come from our own code? The net listens on the window and also catches rejections from
 * browser extensions (MetaMask); reported as an "unexpected error", that sent people looking for the bug
 * in our own code.
 * @param {unknown} error
 */
function fromUs(error) {
  const raw = /** @type {{ stack?: unknown } | null | undefined} */ (error)?.stack;
  const stack = typeof raw === 'string' ? raw : '';
  const urls = stack.match(/\b[a-z][\w.+-]*:\/\/[^\s)]+/gi) || [];
  if (!urls.length) return true;
  return urls.some((/** @type {string} */ a) => a.startsWith(location.origin + '/'));
}

export function bindGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', ev => {
    if (fromUs(ev.reason)) reportUnexpected('promise', ev.reason);
  });
  // Resource errors (images) also go through 'error', but don't bubble up to window — only real script
  // errors arrive here.
  // Without an error object the browser reports it itself, e.g. "ResizeObserver loop …" at a large font
  // size: the user can't do anything about that, and a red toast would send them looking for a bug that
  // isn't one.
  window.addEventListener('error', ev => {
    if (!ev.error || /^ResizeObserver loop/.test(ev.message || '')) {
      console.warn('[script]', ev.message);
      return;
    }
    if (fromUs(ev.error)) reportUnexpected('script', ev.error);
  });
}
