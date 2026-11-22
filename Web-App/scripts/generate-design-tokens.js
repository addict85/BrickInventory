#!/usr/bin/env node
/**
 * Generates the theme files of BOTH UIs from shared/design-tokens.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'shared', 'design-tokens.json');
const TARGET_CSS = path.join(ROOT, 'Web-App', 'public', 'tokens.css');
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
 * CSS names for the few token keys of the shared file that are still German. The app
 * reads the same keys (DunkelTokens.kt), so the file keeps them and only the web side
 * translates — one place instead of every stylesheet.
 */
const CSS_NAMES = {
  'auf-primaer': 'on-primary',
  'a-schrift': 'a-text',
  gewinn: 'profit',
  faecher: 'fan',
  stein: 'brick',
};
/** @param {string} key token key or list prefix in shared/design-tokens.json */
const cssToken = key => CSS_NAMES[/** @type {keyof typeof CSS_NAMES} */ (key)] ?? key;

/**
 * Wrap text into lines, word by word: a regex once swallowed words at the line ends,
 * and a wrap that loses text is worse than none.
 * @param {string} text @param {number} [width] @returns {string[]}
 */
function wrap(text, width = 72) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else line += ' ' + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/**
 * Build the CSS file from the token tables.
 * @param {any} data content of shared/design-tokens.json
 * @returns {string}
 */
function buildCss(data) {
  // The reasoning travels WITH the value, so a note stays next to the line it explains.
  /** @param {string} selector @param {Record<string,string>} tokens @param {boolean} [withNote] */
  const block = (selector, tokens, withNote = true) => {
    const lines = Object.entries(tokens)
      .flatMap(([name, value]) => {
        const note = withNote ? data._notizen?.[name] : undefined;
        // Only the first line opens the comment and only the last closes it: CSS comments do not nest.
        const before = note
          ? ['', ...wrap(note).map((z, i, a) => `  ${i === 0 ? '/* ' : '   '}${z}${i === a.length - 1 ? ' */' : ''}`)]
          : [];
        return [...before, `  --${cssToken(name)}: ${value};`];
      })
      .join('\n');
    return `${selector} {\n${lines}\n}`;
  };
  const parts = [];
  for (const [design, raw] of Object.entries(data.designs)) {
    const tokens = resolved(data, design, raw);
    // A named theme only applies with data-theme set; its higher specificity beats :root.
    parts.push(block(design === 'classic' ? ':root' : `[data-theme="${design}"]`, tokens));
  }
  // Dark variant per theme. TWO attributes, so they beat themes/*.css (one attribute, loaded later).
  if (data.dunkel) {
    parts.push(
      `/* Dark variant — reasoning in shared/design-tokens.json. */\n` +
        block('[data-dark]:is([data-theme], :not([data-theme]))', data.dunkel.basis, false),
    );
    for (const [design, raw] of Object.entries(data.dunkel.designs || {})) {
      const tokens = resolved({ designs: data.dunkel.designs }, design, raw);
      parts.push(
        block(
          design === 'classic'
            ? '[data-dark]:is([data-theme="classic"], :not([data-theme]))'
            : `[data-dark][data-theme="${design}"]`,
          tokens,
          false,
        ),
      );
    }
  }
  // Enumerated colour series: one loop over the lists instead of a copied block per theme.
  for (const list of Object.values(data.listen || {})) {
    const prefix = cssToken(list.praefix);
    const lines = list.werte
      .map((/** @type {string} */ value, /** @type {number} */ i) => `  --${prefix}-${i}: ${value};`)
      .join('\n');
    parts.push([`/* --${prefix}-0… — reasoning in shared/design-tokens.json. */`, ':root {', lines, '}'].join('\n'));
  }
  return `/* ${HINT}\n\n   ${data._warum} */\n\n${parts.join('\n\n')}\n`;
}

/**
 * The tokens of a theme — with `erbt` (inherits) resolved.
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
  const lines = Object.entries(data.app).map(([name, { design, token }]) => {
    const value = resolved(data, design, data.designs[design])[token];
    if (!value) throw new Error(`design-tokens.json: --${token} does not exist in the theme "${design}"`);
    const hex = value.replace('#', '').toUpperCase();
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

${lines.join('\n\n')}
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

// Compute only when called: the check imports this module to run buildCss()/buildKotlin() itself.
if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  /** @type {{file: string, content: string}[]} */
  const outputs = [
    { file: TARGET_CSS, content: buildCss(data) },
    { file: TARGET_KT, content: buildKotlin(data) },
    { file: TARGET_DARK_KT, content: buildKotlinDark(data) },
  ];
  // --check only compares (android.yml checks the Kotlin files this way); --pruefen is the old spelling.
  const checkOnly = process.argv.includes('--check') || process.argv.includes('--pruefen');
  for (const { file, content } of outputs) {
    // A checkout of only the web app (Docker build, partial clone) has no Android app.
    if (!fs.existsSync(path.dirname(file))) {
      console.log(`[design-tokens] skipped, folder missing: ${path.relative(ROOT, path.dirname(file))}`);
      continue;
    }
    if (checkOnly) {
      if (fs.readFileSync(file, 'utf8') === content) continue;
      console.error(`[design-tokens] outdated: ${path.relative(ROOT, file)} (npm run design:tokens)`);
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(file, content);
    console.log(`[design-tokens] ${path.relative(ROOT, file)}`);
  }
}

// For the check: the same calculation, without writing.
module.exports = { buildCss, buildKotlin, buildKotlinDark, cssToken, SOURCE, TARGET_CSS, TARGET_KT, TARGET_DARK_KT };
