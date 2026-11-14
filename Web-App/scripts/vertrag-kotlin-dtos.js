#!/usr/bin/env node
'use strict';

/**
 * Schreibt die Kotlin-Typen der App (core-vertrag, Paket vertrag) aus
 * docs/openapi.json, ohne Netz und ohne Gradle: Antworten aus den Schemas,
 * Rümpfe aus den Anfragen der Routen, die die App schickt. Namen und Fachtypen
 * stehen in vertrag-kotlin-zuordnung.js. Eingecheckt; mit --pruefen nur
 * vergleichen (Rückgabe 1 bei Abweichung). Aufruf: npm run vertrag:kotlin
 */
const fs = require('node:fs');
const path = require('node:path');
const STANDARD = require('./vertrag-kotlin-zuordnung.js');

/** Die Zuordnung des laufenden Aufrufs; Tests geben eine kleine eigene mit. */
let Z = STANDARD;

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'docs', 'openapi.json');
const ZIEL = path.join(
  ROOT,
  '..',
  'Android-App',
  'core-vertrag',
  'src',
  'main',
  'java',
  'ch',
  'brickinventoryapp',
  'vertrag',
  'Vertrag.kt',
);

const SCHLUESSELWOERTER = new Set([
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'when',
  'while',
]);

/** Ein Schema-Name als Kotlin-Klassenname: Wortteile gross, ohne Unterstriche. @param {string} n */
const klassenname = n =>
  n
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
    .join('');

/** Ein JSON-Feldname als Kotlin-Eigenschaft (snake_case → camelCase). @param {string} n */
function eigenschaft(n) {
  const teile = n.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let e = teile.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() : t.charAt(0).toUpperCase()) + t.slice(1)).join('');
  if (/^[0-9]/.test(e)) e = `n${e}`;
  return SCHLUESSELWOERTER.has(e) ? `\`${e}\`` : e;
}

/** Ein Aufzählungswert als Konstante. @param {string} w */
const konstante = w => {
  const k = w
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(k) ? `W_${k}` : k || 'LEER';
};

/**
 * @typedef {{ art: 'grund', name: string } | { art: 'liste', element: Typ } | { art: 'karte', wert: Typ }
 *   | { art: 'klasse', name: string }} TypArt
 * @typedef {TypArt & { nullbar: boolean }} Typ
 * @typedef {{ json: string, typ: Typ, pflicht: boolean }} Feld
 * @typedef {{ name: string, felder: Feld[], werte?: string[], anfrage: boolean, quellen: string[] }} Form
 */

/** @param {string} name @returns {Typ} */
const grund = (name, nullbar = false) => ({ art: 'grund', name, nullbar });

/**
 * Der Typ eines Schemas; verschachtelte Objekte werden als eigene Form [neben]
 * gesammelt, unter dem Rohnamen `<Eltern><Feld>` bzw. `…Eintrag`.
 * @param {any} s @param {string} vorschlag @param {(name: string, s: any) => void} neben @returns {Typ}
 */
function typ(s, vorschlag, neben) {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return grund('JsonElement', true);
  if (s.$ref)
    return {
      art: 'klasse',
      name: klassenname(s.$ref.split('/').pop()),
      nullbar: false,
    };
  if (s.const !== undefined) return grund(grundtyp(typeof s.const === 'number' ? 'number' : typeof s.const));
  if (s.enum)
    return grund(s.enum.every((/** @type {unknown} */ e) => typeof e === 'string') ? 'String' : 'JsonElement');
  const zweige = s.anyOf || s.oneOf;
  if (zweige) {
    const ohneNull = zweige.filter((/** @type {any} */ z) => z.type !== 'null');
    const nullbar = ohneNull.length < zweige.length;
    if (ohneNull.length === 1) {
      const t = typ(ohneNull[0], vorschlag, neben);
      return { ...t, nullbar: nullbar || t.nullbar };
    }
    return grund('JsonElement', nullbar);
  }
  if (Array.isArray(s.type)) {
    const ohneNull = s.type.filter((/** @type {string} */ t) => t !== 'null');
    const nullbar = ohneNull.length < s.type.length;
    if (ohneNull.length === 1) return { ...typ({ ...s, type: ohneNull[0] }, vorschlag, neben), nullbar };
    return grund('JsonElement', nullbar);
  }
  if (s.type === 'array')
    return {
      art: 'liste',
      element: typ(s.items, `${vorschlag}Eintrag`, neben),
      nullbar: false,
    };
  if (s.type === 'object') {
    if (s.properties && Object.keys(s.properties).length) {
      neben(vorschlag, s);
      return { art: 'klasse', name: vorschlag, nullbar: false };
    }
    const wert = s.additionalProperties;
    if (wert && typeof wert === 'object' && Object.keys(wert).length) {
      const w = typ(wert, `${vorschlag}Wert`, neben);
      if (!(w.art === 'grund' && w.name === 'JsonElement')) return { art: 'karte', wert: w, nullbar: false };
    }
    return grund('JsonObject');
  }
  // Ganze Zahlen sind Zähler, Kennungen und Mengen: Int wie in den Ansichten.
  if (s.type === 'integer') return grund('Int');
  return grund(grundtyp(s.type));
}

/** @param {string} t */
function grundtyp(t) {
  return (
    {
      string: 'String',
      number: 'Double',
      boolean: 'Boolean',
      null: 'JsonElement',
    }[t] ?? 'JsonElement'
  );
}

/** @param {Typ} t @returns {string} */
function kotlin(t) {
  const n = t.nullbar ? '?' : '';
  if (t.art === 'liste') return `List<${kotlin(t.element)}>${n}`;
  if (t.art === 'karte') return `Map<String, ${kotlin(t.wert)}>${n}`;
  return `${t.name}${n}`;
}

/**
 * Sammelt alle Formen: die Schemas unter components und die Rümpfe der
 * Anfragen aus Z.ANFRAGEN. Namen sind noch roh (vor Z.NAMEN).
 * @param {any} dok @returns {Form[]}
 */
function sammle(dok) {
  /** @type {Form[]} */
  const formen = [];
  /** @param {string} name @param {any} s @param {boolean} anfrage */
  function form(name, s, anfrage) {
    const neben = (/** @type {string} */ n, /** @type {any} */ x) => form(n, x, anfrage);
    if (s.enum) {
      formen.push({
        name,
        felder: [],
        werte: s.enum,
        anfrage,
        quellen: [name],
      });
      return;
    }
    const pflicht = new Set(s.required ?? []);
    const felder = Object.entries(s.properties ?? {}).map(([json, schema]) => ({
      json,
      typ: typ(schema, name + klassenname(json), neben),
      pflicht: pflicht.has(json),
    }));
    formen.push({ name, felder, anfrage, quellen: [name] });
  }
  const schemas = dok.components?.schemas ?? {};
  for (const n of Object.keys(schemas)) if (!Z.AUSLASSEN.has(klassenname(n))) form(klassenname(n), schemas[n], false);
  const gleichfoermig = (/** @type {string} */ p) => p.replace(/\{\w+\}/g, '{}');
  for (const [route, name] of Object.entries(Z.ANFRAGEN)) {
    const [methode, pfad] = route.split(' ');
    const op = Object.entries(dok.paths ?? {}).find(([p]) => gleichfoermig(p) === gleichfoermig(pfad ?? ''))?.[1];
    const s = op?.[(methode ?? '').toLowerCase()]?.requestBody?.content?.['application/json']?.schema;
    if (!s) throw new Error(`${route}: kein Rumpf im Vertrag (vertrag-kotlin-zuordnung.js, ANFRAGEN)`);
    form(name, s, true);
  }
  return formen;
}

/** @param {string} n */
const endname = n => Z.NAMEN[n] ?? n;

/** @param {Typ} t @returns {Typ} */
function umbenannt(t) {
  if (t.art === 'liste') return { ...t, element: umbenannt(t.element) };
  if (t.art === 'karte') return { ...t, wert: umbenannt(t.wert) };
  if (t.art === 'klasse') return { ...t, name: endname(t.name) };
  return t;
}

/** Ein Fachtyp an die Stelle des innersten String setzen (Liste bleibt Liste). @param {Typ} t @param {string} fach @returns {Typ} */
function mitFachtyp(t, fach) {
  if (t.art === 'liste') return { ...t, element: mitFachtyp(t.element, fach) };
  // Mit eigenem Serializer liest sich Unbekanntes als null: dann ist das Feld immer nullbar.
  if (t.art === 'grund' && t.name === 'String')
    return {
      ...t,
      name: fach,
      nullbar: t.nullbar || !!Z.FACHTYPEN[fach]?.serializer,
    };
  // Ein offenes Schema ({} oder Text|Zahl) bekommt den Typ, den die App schickt.
  if (t.art === 'grund' && t.name === 'JsonElement') return { ...t, name: fach };
  throw new Error(`Fachtyp ${fach} nur an Stelle eines String (${kotlin(t)})`);
}

/**
 * Formen gleichen Endnamens zu einer: Felder vereint, Pflicht nur, wo alle es
 * verlangen, nullbar, wo eine es erlaubt; derselbe Name heisst derselbe Typ.
 * @param {Form[]} formen @returns {Map<string, Form>}
 */
function vereine(formen) {
  /** @type {Map<string, Form>} */
  const aus = new Map();
  for (const f of formen) {
    const name = endname(f.name);
    const felder = f.felder.map(x => {
      const fach = Z.FELDTYPEN[`${name}.${x.json}`];
      const t = umbenannt(x.typ);
      return { ...x, typ: fach ? mitFachtyp(t, fach) : t };
    });
    const da = aus.get(name);
    if (!da) {
      aus.set(name, { ...f, name, felder });
      continue;
    }
    if (da.anfrage !== f.anfrage) throw new Error(`${name}: Anfrage und Antwort in einer Form (${f.name})`);
    if (da.werte || f.werte) throw new Error(`${name}: Aufzählung lässt sich nicht vereinen`);
    const alle = new Map(da.felder.map(x => [x.json, x]));
    for (const x of felder) {
      const y = alle.get(x.json);
      if (!y) {
        alle.set(x.json, { ...x, pflicht: false });
        continue;
      }
      const offen = [x.typ, y.typ].some(t => t.art === 'grund' && t.name === 'JsonElement');
      if (offen) {
        alle.set(x.json, {
          ...y,
          pflicht: false,
          typ: grund('JsonElement', true),
        });
        continue;
      }
      if (kotlin({ ...x.typ, nullbar: false }) !== kotlin({ ...y.typ, nullbar: false }))
        throw new Error(
          `${name}.${x.json}: ${kotlin(y.typ)} in ${da.quellen.join(', ')}, ${kotlin(x.typ)} in ${f.name}`,
        );
      alle.set(x.json, {
        ...y,
        pflicht: y.pflicht && x.pflicht,
        typ: { ...y.typ, nullbar: y.typ.nullbar || x.typ.nullbar },
      });
    }
    for (const [json, y] of alle) if (!felder.some(x => x.json === json)) alle.set(json, { ...y, pflicht: false });
    aus.set(name, {
      ...da,
      felder: [...alle.values()],
      quellen: [...da.quellen, f.name],
    });
  }
  return aus;
}

/**
 * Der Leerwert eines Antwortfelds. Jedes Feld hat einen: Ein älterer Server,
 * dem ein neues Feld fehlt, und eine abgelegte ältere Antwort bleiben lesbar.
 * @param {Typ} t @returns {string}
 */
function leerwert(t) {
  if (t.nullbar) return 'null';
  if (t.art === 'liste') return 'emptyList()';
  if (t.art === 'karte') return 'emptyMap()';
  if (t.art === 'klasse') return `${t.name}()`;
  const fach = Z.FACHTYPEN[t.name];
  if (fach) return fach.leer;
  return (
    /** @type {Record<string, string>} */ ({
      String: '""',
      Int: '0',
      Double: '0.0',
      Boolean: 'false',
      JsonObject: 'JsonObject(emptyMap())',
      JsonElement: 'JsonNull',
    })[t.name] ?? 'null'
  );
}

/**
 * Ein Rumpffeld: Pflichtfelder ohne Vorgabe (der Aufrufer nennt sie), freiwillige
 * gehen nur hinaus, wenn sie gesetzt sind — encodeDefaults schickte sonst null,
 * und der Server läse „löschen“ statt „unverändert“ (Ausnahmen: Z.NULL_SENDEN).
 * @param {string} name @param {string} schluessel @param {Feld} f @param {string | undefined} vorgabe
 */
function rumpffeld(name, schluessel, f, vorgabe) {
  const t = kotlin(f.typ);
  if (vorgabe !== undefined)
    return `val ${name}: ${Z.PFLICHT.has(schluessel) ? kotlin({ ...f.typ, nullbar: false }) : t} = ${vorgabe}`;
  if (f.pflicht) return `val ${name}: ${t}`;
  if (Z.PFLICHT.has(schluessel)) return `val ${name}: ${kotlin({ ...f.typ, nullbar: false })}`;
  if (Z.NULL_SENDEN.has(schluessel)) return `val ${name}: ${kotlin({ ...f.typ, nullbar: true })} = null`;
  return `@EncodeDefault(EncodeDefault.Mode.NEVER) val ${name}: ${kotlin({ ...f.typ, nullbar: true })} = null`;
}

/**
 * Ein Antwortfeld, das fehlen darf, liest sich als Leerwert, ausser es steht in
 * Z.NULLBAR: dort heisst „fehlt“ etwas anderes als „leer“.
 * @param {string} klasse @param {Feld} f @returns {Typ}
 */
function antworttyp(klasse, f) {
  if (f.pflicht || f.typ.nullbar) return f.typ;
  const ohneLeerwert = f.typ.art === 'klasse' && STRENG.has(f.typ.name);
  return ohneLeerwert || Z.NULLBAR.has(`${klasse}.${f.json}`) ? { ...f.typ, nullbar: true } : f.typ;
}

/** Antwortformen mit Pflichtfeldern: Sie haben keinen Leerwert `Form()`. */
let STRENG = new Set();

/** @param {Form} f @returns {string} */
function klasse(f) {
  if (f.werte) {
    const werte = f.werte.map(w => `    @SerialName(${JSON.stringify(w)}) ${konstante(w)},`);
    return `@Serializable\nenum class ${f.name} {\n${werte.join('\n')}\n}`;
  }
  if (!f.felder.length) return `@Serializable\nclass ${f.name}`;
  const felder = f.felder.map(x => {
    const schluessel = `${f.name}.${x.json}`;
    const name = Z.EIGENSCHAFTEN[schluessel] ?? eigenschaft(x.json);
    const vorgabe = Z.VORGABEN[schluessel];
    const t = antworttyp(f.name, x);
    const decl = f.anfrage
      ? rumpffeld(name, schluessel, x, vorgabe)
      : x.pflicht && vorgabe === undefined && Z.STRENG.has(schluessel)
        ? `val ${name}: ${kotlin(t)}`
        : `val ${name}: ${kotlin(t)} = ${vorgabe ?? leerwert(t)}`;
    const ser = x.typ.art === 'grund' ? Z.FACHTYPEN[x.typ.name]?.serializer : undefined;
    const mit = ser ? `@Serializable(with = ${ser.split('.').pop()}::class) ` : '';
    return `    ${mit}@SerialName(${JSON.stringify(x.json)}) ${decl},`;
  });
  return `@Serializable\ndata class ${f.name}(\n${felder.join('\n')}\n)`;
}

/**
 * Die Kotlin-Datei aus dem OpenAPI-Dokument.
 * @param {any} dok @param {typeof STANDARD} [zuordnung] @returns {string}
 */
function erzeuge(dok, zuordnung = STANDARD) {
  Z = zuordnung;
  try {
    return datei(dok);
  } finally {
    Z = STANDARD;
  }
}

/** @param {any} dok @returns {string} */
function datei(dok) {
  const formen = [...vereine(sammle(dok)).values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  STRENG = new Set(
    formen
      .filter(f => !f.anfrage && f.felder.some(x => x.pflicht && Z.STRENG.has(`${f.name}.${x.json}`)))
      .map(f => f.name),
  );
  const rumpf = formen.map(klasse).join('\n\n');
  const importe = ['kotlinx.serialization.SerialName', 'kotlinx.serialization.Serializable'];
  if (/@EncodeDefault/.test(rumpf))
    importe.push('kotlinx.serialization.EncodeDefault', 'kotlinx.serialization.ExperimentalSerializationApi');
  for (const j of ['JsonElement', 'JsonNull', 'JsonObject'])
    if (new RegExp(`\\b${j}\\b`).test(rumpf)) importe.push(`kotlinx.serialization.json.${j}`);
  for (const [n, f] of Object.entries(Z.FACHTYPEN)) {
    if (new RegExp(`\\b${n}\\b`).test(rumpf)) importe.push(f.paket);
    if (f.serializer && rumpf.includes(`${f.serializer.split('.').pop()}::class`)) importe.push(f.serializer);
  }
  for (const [n, paket] of Object.entries(Z.KONSTANTEN)) if (new RegExp(`= ${n}\\b`).test(rumpf)) importe.push(paket);
  const optIn = /@EncodeDefault/.test(rumpf) ? '@file:OptIn(ExperimentalSerializationApi::class)\n' : '';
  return (
    '// Erzeugt aus Web-App/docs/openapi.json durch Web-App/scripts/vertrag-kotlin-dtos.js.\n' +
    '// Nicht von Hand ändern: npm run vertrag:kotlin (im Ordner Web-App).\n' +
    '@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")\n' +
    optIn +
    '\npackage ch.brickinventoryapp.vertrag\n\n' +
    importe
      .sort()
      .map(i => `import ${i}`)
      .join('\n') +
    '\n\n' +
    rumpf +
    '\n'
  );
}

if (require.main === module) {
  const soll = erzeuge(JSON.parse(fs.readFileSync(QUELLE, 'utf8')));
  // --pruefen schreibt nicht, es meldet nur eine Abweichung (Test und CI).
  if (process.argv.includes('--pruefen')) {
    const ist = fs.existsSync(ZIEL) ? fs.readFileSync(ZIEL, 'utf8') : '';
    if (ist !== soll) {
      console.error(`${path.relative(ROOT, ZIEL)} ist veraltet — npm run vertrag:kotlin`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(ZIEL), { recursive: true });
    fs.writeFileSync(ZIEL, soll);
    console.log(`geschrieben: ${path.relative(ROOT, ZIEL)}`);
  }
}

module.exports = { QUELLE, ZIEL, erzeuge, sammle, klassenname };
