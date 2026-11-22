#!/usr/bin/env node
/**
 * Generates the theme files of BOTH UIs from shared/design-tokens.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const WURZEL = path.join(__dirname, '..', '..');
const QUELLE = path.join(WURZEL, 'shared', 'design-tokens.json');
const TARGET_CSS = path.join(WURZEL, 'Web-App', 'public', 'tokens.css');
const TARGET_KT = path.join(
  __dirname,
  '..',
  '..',
  'Android-App',
  'core-ui',
  'src',
  'main',
  'java',
  'ch',
  'brickinventoryapp',
  'ui',
  'theme',
  'DesignTokens.kt',
);
const TARGET_DARK_KT = path.join(path.dirname(TARGET_KT), 'DunkelTokens.kt');

const HINT = 'GENERATED from shared/design-tokens.json — do NOT edit by hand.';

/**
 * Wrap text into lines.
 *
 * Word by word, not via regex: the first version used
 * `/(.{1,68})(\s|$)/g` and swallowed words in the process — the KDoc said
 * "Der Grund ist nicht" and right after that "die Legende nicht lesen".
 * A wrap that loses text is worse than none.
 */
/** @param {string} text @param {number} [width] @returns {string[]} */
function wrap(text, width = 72) {
  const rows = [];
  let z = '';
  for (const wort of text.split(/\s+/)) {
    if ((z + ' ' + wort).trim().length > width) {
      rows.push(z.trim());
      z = wort;
    } else z += ' ' + wort;
  }
  if (z.trim()) rows.push(z.trim());
  return rows;
}

/**
 * Build the CSS file from the token tables.
 * @param {any} data content of shared/design-tokens.json
 * @returns {string}
 */
function buildCss(data) {
  // The reasoning travels WITH the value. It used to stand as a comment next to
  // the line in styles.css or themes/brick.css; if it did not move along,
  // after two years nobody could understand why the
  // used line is sand and not blue.
  /** @param {string} choice @param {Record<string,string>} tokens @param {boolean} [withNote] */
  const block = (choice, tokens, withNote = true) => {
    const rows = Object.entries(tokens)
      .flatMap(([name, wert]) => {
        const note = withNote ? data._notizen?.[name] : undefined;
        // Only the FIRST line opens the comment, only the last one closes
        // it. CSS comments do not nest: a `/*` on every line would
        // happen to be valid (everything up to the first `*/` belongs to it), but would read
        // wrongly and break as soon as someone rearranges a line.
        const vor = note
          ? ['', ...wrap(note).map((z, i, a) => `  ${i === 0 ? '/* ' : '   '}${z}${i === a.length - 1 ? ' */' : ''}`)]
          : [];
        return [...vor, `  --${name}: ${wert};`];
      })
      .join('\n');
    return `${choice} {\n${rows}\n}`;
  };
  const parts = [];
  for (const [design, raw] of Object.entries(data.designs)) {
    const tokens = resolved(data, design, raw);
    // The base theme always applies, a named theme only with data-theme
    // set. Its higher specificity wins against :root — the
    // order in the file therefore does not matter.
    parts.push(block(design === 'classic' ? ':root' : `[data-theme="${design}"]`, tokens));
  }
  // Dark variant per theme (see _dunkel_warum). The selectors carry
  // TWO attributes, so that they beat the themes/*.css (one attribute), which
  // are loaded after tokens.css.
  if (data.dunkel) {
    parts.push(
      `/* Dark variant — see _dunkel_warum in shared/design-tokens.json. */\n` +
        block('[data-dunkel]:is([data-theme], :not([data-theme]))', data.dunkel.basis, false),
    );
    for (const [design, raw] of Object.entries(data.dunkel.designs || {})) {
      const tokens = resolved({ designs: data.dunkel.designs }, design, raw);
      parts.push(
        block(
          design === 'classic'
            ? '[data-dunkel]:is([data-theme="classic"], :not([data-theme]))'
            : `[data-dunkel][data-theme="${design}"]`,
          tokens,
          false,
        ),
      );
    }
  }
  // Enumerated color series. ONE hard-wired block for the theme fan
  // used to stand here; with the brick colors of the theme "noppe"
  // a second copy of the same eight lines would have arisen next to it. Now
  // the loop enumerates what stands in `listen`.
  for (const [name, list] of Object.entries(data.listen || {})) {
    const rows = list.werte
      .map((/** @type {string} */ wert, /** @type {number} */ i) => `  --${list.praefix}-${i}: ${wert};`)
      .join('\n');
    parts.push(
      [`/* ${name} — see listen.${name}.warum in shared/design-tokens.json. */`, ':root {', rows, '}'].join('\n'),
    );
  }
  return `/* ${HINT}\n\n   ${data._warum} */\n\n${parts.join('\n\n')}\n`;
}

/**
 * The tokens of a theme — with `erbt` resolved.
 * @param {any} data content of shared/design-tokens.json
 * @param {string} name name of the theme
 * @param {Record<string,string>} raw the entry as it stands in the file
 * @returns {Record<string,string>}
 */
function resolved(data, name, raw) {
  const source = raw.erbt;
  if (!source) return raw;
  const inherited = data.designs[source];
  if (!inherited) throw new Error(`design-tokens.json: "${name}" inherits from "${source}", which does not exist`);
  if (inherited.erbt)
    throw new Error(
      `design-tokens.json: "${name}" inherits from "${source}", which itself inherits — one level, no chain`,
    );
  const { erbt, ...own } = raw;
  return { ...inherited, ...own };
}

/**
 * Build the Kotlin file from the app mapping.
 * @param {any} data content of shared/design-tokens.json
 * @returns {string}
 */
function buildKotlin(data) {
  const rows = Object.entries(data.app).map(([name, { design, token }]) => {
    const wert = resolved(data, design, data.designs[design])[token];
    if (!wert) throw new Error(`design-tokens.json: --${token} does not exist in the theme "${design}"`);
    const hex = wert.replace('#', '').toUpperCase();
    const note = data._notizen?.[token];
    const kdoc = note
      ? ['/**', ` * --${token} in the theme "${design}".`, ' *', ...wrap(note, 68).map(z => ` * ${z}`), ' */'].join(
          '\n',
        )
      : `/** --${token} in the theme "${design}". */`;
    return `${kdoc}\nval ${name} = Color(0xFF${hex})`;
  });
  // The same generalization as in the CSS above.
  const slotsBlock = Object.values(data.listen || {})
    .map((/** @type {any} */ list) => {
      const colors = list.werte
        .map((/** @type {string} */ w) => `    Color(0xFF${w.replace('#', '').toUpperCase()}),`)
        .join('\n');
      return `

/**
${wrap(list.warum, 68)
  .map((/** @type {string} */ z) => ` * ${z}`)
  .join('\n')}
 */
val ${list.kotlin} = listOf(
${colors}
)
`;
    })
    .join('');

  return `package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * ${HINT}
 *
 * ${data._app_warum}
 *
 * Generated by Web-App/scripts/generate-design-tokens.js. Whoever changes a
 * value here changes it only in the app — and that is exactly what this file
 * is meant to prevent. The value belongs in shared/design-tokens.json.
 */

${rows.join('\n\n')}
${slotsBlock}`;
}

/**
 * Build the Kotlin table of the dark version from the section `dunkel`.
 * Only the values: resolving `erbt` and assigning the Material roles are rules
 * and stand by hand in DunkleRollen.kt.
 * @param {any} data content of shared/design-tokens.json
 * @returns {string}
 */
function buildKotlinDark(data) {
  if (!data.dunkel) throw new Error('design-tokens.json: section "dunkel" is missing');
  /** @param {Record<string,string>} t @param {string} indent */
  const pairs = (t, indent) =>
    Object.entries(t)
      .map(([k, v]) => `${indent}${JSON.stringify(k)} to ${JSON.stringify(v)},`)
      .join('\n');
  const designs = Object.entries(data.dunkel.designs || {})
    .map(([name, t]) => `        ${JSON.stringify(name)} to mapOf(\n${pairs(t, '            ')}\n        ),`)
    .join('\n');
  return `package ch.brickinventoryapp.ui.theme

/**
 * ${HINT}
 *
${wrap(data._dunkel_warum, 72)
  .map((/** @type {string} */ z) => ` * ${z}`)
  .join('\n')}
 *
 * Generated by Web-App/scripts/generate-design-tokens.js. The rules for it
 * (erbt, Material roles) are in DunkleRollen.kt.
 */
object DunkelTokens {
    val basis: Map<String, String> = mapOf(
${pairs(data.dunkel.basis, '        ')}
    )

    val designs: Map<String, Map<String, String>> = mapOf(
${designs}
    )
}
`;
}

// Compute only when called, not when loading: the check imports this
// module only to apply buildCss()/buildKotlin() itself — it does not need the
// result already at require time.
if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));
  /** @type {{datei: string, inhalt: string}[]} */
  const outputs = [
    { datei: TARGET_CSS, inhalt: buildCss(data) },
    { datei: TARGET_KT, inhalt: buildKotlin(data) },
    { datei: TARGET_DARK_KT, inhalt: buildKotlinDark(data) },
  ];
  for (const { datei, inhalt } of outputs) {
    // A checkout of only the web app (Docker build, partial clone) has no
    // Android app; its tokens are then maintained by the complete checkout.
    if (!fs.existsSync(path.dirname(datei))) {
      console.log(`[design-tokens] skipped, folder missing: ${path.relative(WURZEL, path.dirname(datei))}`);
      continue;
    }
    // --pruefen: only compare; the Android run checks the Kotlin files this way (android.yml).
    if (process.argv.includes('--pruefen')) {
      if (fs.readFileSync(datei, 'utf8') === inhalt) continue;
      console.error(`[design-tokens] outdated: ${path.relative(WURZEL, datei)} (npm run design:tokens)`);
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(datei, inhalt);
    console.log(`[design-tokens] ${path.relative(WURZEL, datei)}`);
  }
}

// For the check: the same calculation, without writing.
module.exports = { buildCss, buildKotlin, buildKotlinDark, QUELLE, TARGET_CSS, TARGET_KT, TARGET_DARK_KT };
