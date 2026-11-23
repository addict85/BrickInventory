/**
 * Finds catches in the source text: `catch (e) { … }`, `catch { … }` and `.catch(e => …)`.
 * Comments and strings are blanked out beforehand (same length) so that a
 * `catch` in text does not count and the location stays the original one.
 */

/** Replaces comments and the content of strings with spaces or `x`. */
function mask(s) {
  let o = '',
    i = 0;
  const n = s.length;
  const empty = c => (c === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = s[i],
      d = s[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && s[i] !== '\n') {
        o += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) o += empty(s[i++]);
      o += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      o += c;
      i++;
      while (i < n && s[i] !== c) {
        if (s[i] === '\\') {
          o += '  ';
          i += 2;
          continue;
        }
        // In `${…}` there is code: it stays visible, braces count along.
        if (c === '`' && s[i] === '$' && s[i + 1] === '{') {
          let depth = 1;
          o += '${';
          i += 2;
          while (i < n && depth) {
            if (s[i] === '{') depth++;
            else if (s[i] === '}') depth--;
            o += depth ? s[i] : '}';
            i++;
          }
          continue;
        }
        o += s[i] === '\n' ? '\n' : 'x';
        i++;
      }
      o += c;
      i++;
      continue;
    }
    o += c;
    i++;
  }
  return o;
}

function closes(s, i, opened, closed) {
  let t = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === opened) t++;
    else if (s[j] === closed && --t === 0) return j;
  }
  return -1;
}

/** Top-level statements of a body (roughly: split at `;`). */
function instructions(body) {
  const r = [];
  let t = 0,
    cur = '';
  for (const c of body) {
    if ('({['.includes(c)) t++;
    if (')}]'.includes(c)) t--;
    if (c === ';' && t === 0) {
      r.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  r.push(cur.trim());
  return r.filter(Boolean);
}

/**
 * Every catch of a file with masked body (`rumpf`), original text (`roh`) and line.
 * For `.catch(…)` only arrow functions: `.catch(logAndContinue('x'))` is counted by another ratchet.
 */
function catches(source) {
  const s = mask(source);
  const result = [];
  const re = /\bcatch\b\s*(?:\(\s*\w*\s*(?::\s*\w+)?\s*\))?\s*\{|\.catch\(/g;
  for (const m of s.matchAll(re)) {
    let a, e;
    if (m[0].startsWith('.')) {
      const opened = m.index + m[0].length - 1;
      const closed = closes(s, opened, '(', ')');
      const arg = s.slice(opened + 1, closed);
      const arrowIcon = /^\s*(?:async\s*)?(?:\(\s*\w*\s*(?::\s*\w+)?\s*\)|\w+)\s*=>\s*/.exec(arg);
      if (!arrowIcon) continue;
      a = opened + 1 + arrowIcon[0].length;
      e = closed;
      if (s[a] === '{') {
        e = closes(s, a, '{', '}');
        a++;
      }
    } else {
      a = m.index + m[0].length;
      e = closes(s, a - 1, '{', '}');
    }
    result.push({
      row: source.slice(0, m.index).split('\n').length,
      body: s.slice(a, e),
      raw: source.slice(a, e),
    });
  }
  return result;
}

const LOG = /^(?:void\s+)?(?:console\.\w+|reportError|log|warn)\s*\(/;

/**
 * “Only report and continue”: no `throw`, at least one report, otherwise at most one
 * `return …`, `continue` or `break`. A substitute value after the report counts too, it is
 * reportAndDeliver without the name.
 */
function onlyReported(f) {
  if (/\bthrow\b/.test(f.body)) return false;
  const st = instructions(f.body);
  const rest = st.filter(x => !LOG.test(x));
  return (
    rest.length < st.length &&
    (rest.length === 0 || (rest.length === 1 && /^(?:return|continue|break)\b/.test(rest[0])))
  );
}

/** Without a report to the UI or into the log, without `throw`: the error is gone. */
const REPORTS_UI =
  /\bthrow\b|\b(?:toast|show\w*|report\w*|set(?:Error|Status)\w*|error\w*|console\.\w+|reject|alert)\s*\(|\.(?:textContent|hidden)\s*=/;
function silentInBrowser(f) {
  return !REPORTS_UI.test(f.body);
}

module.exports = { mask, catches, onlyReported, silentInBrowser };
