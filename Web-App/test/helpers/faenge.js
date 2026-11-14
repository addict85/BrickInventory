/**
 * Findet Fänge im Quelltext: `catch (e) { … }`, `catch { … }` und `.catch(e => …)`.
 * Kommentare und Zeichenketten werden vorher ausgeblendet (gleich lang), damit ein
 * `catch` im Text nicht zählt und die Fundstelle im Original bleibt.
 */

/** Ersetzt Kommentare und den Inhalt von Zeichenketten durch Leerzeichen bzw. `x`. */
function maskiere(s) {
  let o = '',
    i = 0;
  const n = s.length;
  const leer = c => (c === '\n' ? '\n' : ' ');
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
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) o += leer(s[i++]);
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
        // In `${…}` steht Code: Er bleibt sichtbar, Klammern zählen mit.
        if (c === '`' && s[i] === '$' && s[i + 1] === '{') {
          let tiefe = 1;
          o += '${';
          i += 2;
          while (i < n && tiefe) {
            if (s[i] === '{') tiefe++;
            else if (s[i] === '}') tiefe--;
            o += tiefe ? s[i] : '}';
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

function schliesst(s, i, auf, zu) {
  let t = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === auf) t++;
    else if (s[j] === zu && --t === 0) return j;
  }
  return -1;
}

/** Anweisungen der obersten Ebene eines Rumpfs (grob: an `;` getrennt). */
function anweisungen(rumpf) {
  const r = [];
  let t = 0,
    cur = '';
  for (const c of rumpf) {
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
 * Jeder Fang einer Datei mit maskiertem Rumpf (`rumpf`), Originaltext (`roh`) und Zeile.
 * Bei `.catch(…)` nur Pfeilfunktionen: `.catch(logAndContinue('x'))` zählt eine andere Ratsche.
 */
function faenge(quelle) {
  const s = maskiere(quelle);
  const raus = [];
  const re = /\bcatch\b\s*(?:\(\s*\w*\s*(?::\s*\w+)?\s*\))?\s*\{|\.catch\(/g;
  for (const m of s.matchAll(re)) {
    let a, e;
    if (m[0].startsWith('.')) {
      const auf = m.index + m[0].length - 1;
      const zu = schliesst(s, auf, '(', ')');
      const arg = s.slice(auf + 1, zu);
      const pfeil = /^\s*(?:async\s*)?(?:\(\s*\w*\s*(?::\s*\w+)?\s*\)|\w+)\s*=>\s*/.exec(arg);
      if (!pfeil) continue;
      a = auf + 1 + pfeil[0].length;
      e = zu;
      if (s[a] === '{') {
        e = schliesst(s, a, '{', '}');
        a++;
      }
    } else {
      a = m.index + m[0].length;
      e = schliesst(s, a - 1, '{', '}');
    }
    raus.push({
      zeile: quelle.slice(0, m.index).split('\n').length,
      rumpf: s.slice(a, e),
      roh: quelle.slice(a, e),
    });
  }
  return raus;
}

const PROTOKOLL = /^(?:void\s+)?(?:console\.\w+|meldeFehler|log|warn)\s*\(/;

/**
 * „Nur melden und weiter“: kein `throw`, mindestens eine Meldung, sonst höchstens ein
 * `return …`, `continue` oder `break`. Ein Ersatzwert nach der Meldung zählt mit, er ist
 * meldeUndLiefere ohne den Namen.
 */
function nurGemeldet(f) {
  if (/\bthrow\b/.test(f.rumpf)) return false;
  const st = anweisungen(f.rumpf);
  const rest = st.filter(x => !PROTOKOLL.test(x));
  return (
    rest.length < st.length &&
    (rest.length === 0 || (rest.length === 1 && /^(?:return|continue|break)\b/.test(rest[0])))
  );
}

/** Ohne Meldung an die Oberfläche oder ins Protokoll, ohne `throw`: Der Fehler ist weg. */
const MELDET_OBERFLAECHE =
  /\bthrow\b|\b(?:toast|zeige\w*|melde\w*|setze(?:Fehler|Status)\w*|fehler\w*|console\.\w+|reject|alert)\s*\(|\.(?:textContent|hidden)\s*=/;
function stillImBrowser(f) {
  return !MELDET_OBERFLAECHE.test(f.rumpf);
}

module.exports = { maskiere, faenge, nurGemeldet, stillImBrowser };
