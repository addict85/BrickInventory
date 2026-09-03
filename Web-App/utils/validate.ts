/**
 * Eingangsvalidierung für frei erfassbare Katalogfelder.
 *
 * Vorher gab es KEINE: addManualPart()/addManualMinifig() haben part_number,
 * part_name, color_name, category_name, note und vor allem image_url genau so
 * übernommen, wie sie ankamen — beliebige Länge, beliebige Zeichen, beliebiges
 * URL-Schema. Zusammen mit den innerHTML-Templates im Frontend war das der
 * Einstiegspunkt für Stored XSS (`image_url` mit einem " brach aus dem
 * src-Attribut aus, `javascript:` als Schema wurde ungeprüft durchgereicht).
 *
 * Das Escaping im Frontend ist die eine Hälfte der Lösung; dass gar nicht erst
 * Unsinn in der DB landet, die andere. Beide sind nötig — Escaping schützt die
 * Webapp, die Validierung zusätzlich jeden anderen Konsumenten der API.
 */

/** Teile-/Figuren-/Setnummern: das, was Rebrickable und BrickLink tatsächlich vergeben. */
export const ITEM_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function fail(msg: string): never {
  const e: any = new Error(msg);
  e.status = 400;
  throw e;
}

/** Pflichtfeld: Item-Nummer (Teil, Minifigur, Set). */
export function requireItemNumber(value: any, field = 'part_number'): string {
  const v = String(value ?? '').trim();
  if (!v) fail(`${field} erforderlich`);
  if (!ITEM_NUMBER_RE.test(v))
    fail(`${field} darf nur Buchstaben, Zahlen und . _ - / enthalten (max. 64 Zeichen)`);
  return v;
}

/** Optionales Freitextfeld — auf maxLen gekappt statt abgelehnt (Katalognamen sind lang). */
export function optionalText(value: any, maxLen = 200): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return v ? v.slice(0, maxLen) : null;
}

/**
 * Optionale Bild-URL. Nur https und nur ein wohlgeformter Host —
 * "javascript:…", "data:…" und Attribut-Ausbrüche fallen damit raus.
 */
export function optionalImageUrl(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (v.length > 2048) fail('image_url ist zu lang');
  let u: URL;
  try { u = new URL(v); } catch { fail('image_url ist keine gültige URL'); }
  if (u.protocol !== 'https:') fail('image_url muss https sein');
  return u.toString();
}

/** Menge: positive Ganzzahl in einem plausiblen Rahmen. */
export function positiveInt(value: any, fallback = 1, max = 1_000_000): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}

/** Farb-ID: nicht-negative Ganzzahl. */
export function colorId(value: any): number {
  const n = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Hex-Farbcode ohne führendes '#'. Ungültige Werte werden verworfen, nicht abgelehnt. */
export function optionalHex(value: any): string | null {
  const v = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** Zustand: 'N' oder 'U', sonst null (= keine Angabe). */
export function optionalCondition(value: any): 'N' | 'U' | null {
  return value === 'N' || value === 'U' ? value : null;
}

/**
 * Menge einer Erfassung: 1 bis 10 000.
 *
 * `positiveInt` deckelt bei einer Million — für eine Sammlung ist das keine
 * Grenze, sondern eine Zahl. Am laufenden Server kam über die API
 * `quantity: 999999999` durch und stand danach als 999 999 995 in `sets`; jede
 * Wertangabe daraus ist Unsinn, und die Kachel zeigt sie an.
 *
 * 10 000 ist grosszügig gewählt: Wer mehr als zehntausend Exemplare DESSELBEN
 * Sets besitzt, hat kein Erfassungsproblem, sondern ein Lager.
 */
export function acquisitionQuantity(value: any, fallback = 1): number {
  return positiveInt(value, fallback, 10_000);
}

/**
 * Kaufpreis oder Stückpreis: nicht negativ, in plausiblem Rahmen.
 *
 * Negative Beträge gingen an ALLEN drei Erfassen-Wegen durch (Set, manuelles
 * Teil, manuelle Minifigur) und wanderten unverändert in die Summen des
 * Finanzreiters — ein Tippfehler mit Minuszeichen senkte damit stillschweigend
 * den Gesamtwert der Sammlung.
 *
 * Die Weboberfläche verhindert das mit `min="0"`. Die Regel gehört aber auf den
 * Server: Die App und jeder API-Aufruf gehen an der Oberfläche vorbei.
 *
 * @returns null bei leerer Angabe (= „kein Preis"), sonst der geprüfte Betrag
 */
export function optionalPrice(value: any, feld = 'Preis'): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (n < 0) fail(`${feld} darf nicht negativ sein`);
  if (n > 1_000_000) fail(`${feld} ist unplausibel hoch`);
  return n;
}

/**
 * Einen Wahrheitswert aus einer Anfrage lesen — streng.
 *
 * ── Warum nicht einfach `wert ? 1 : 0` ──────────────────────────────────────
 * Genau das stand an beiden Rollen-Endpunkten (PUT /api/auth/users/:id/admin
 * und PUT /api/v1/admin/users/:id/role). In JavaScript ist die ZEICHENKETTE
 * "false" wahr. Am laufenden Endpunkt nachgestellt:
 *
 *   {"is_admin": false}     → HTTP 200, Rechte entzogen      ✓
 *   {"is_admin": "false"}   → HTTP 200, Rechte NICHT entzogen ⚠
 *   {"is_admin": "0"}       → HTTP 200, Rechte NICHT entzogen ⚠
 *
 * Der Admin bekommt „erfolgreich" gemeldet und glaubt, die Rechte entzogen zu
 * haben — sie bestehen weiter. Zusätzlich lief der Selbstschutz („eigene
 * Admin-Rolle kann nicht entfernt werden") ins Leere, weil auch er den Wert
 * nur auf Wahrheitsgehalt prüfte. Ein Formular mit application/x-www-form-
 * urlencoded oder ein Client, der Wahrheitswerte als Text schickt, trifft das
 * sofort.
 *
 * Lieber laut scheitern als still das Gegenteil tun: Was nicht eindeutig als
 * wahr oder falsch lesbar ist, wird abgewiesen.
 */
export function strictBool(value: any, feld = 'Wert'): boolean {
  if (value === true  || value === 'true'  || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  fail(`${feld} muss true oder false sein`);
}

/**
 * Ist dieser Wert ein ERSATZTEIL-Kennzeichen, das „ja" bedeutet?
 *
 * ── Warum das nötig wurde ───────────────────────────────────────────────────
 * NACHGEMESSEN: `is_spare` wurde an SECHS Stellen gedeutet, mit vier
 * verschiedenen Vorstellungen davon, was „ja" heisst:
 *
 *   utils/handlers/parts.ts    true, 1, 't', 'true'
 *   routes/api_v1/sets.ts      true, 1, 't', 'true', 'True'   ← eine mehr
 *   routes/api_v1/sets.ts      r.is_spare ? 't' : 'f'         ← dritte Form
 *   routes/api_v1/sets.ts      nicht-Ersatzteil: 'f','false','False','0',''
 *   routes/api_v1/minifigs.ts  nur 't'
 *   Android, Part.isSpareFlag  '1', 'true', 't'               ← ohne 'True'
 *
 * Die Spalte ist INTEGER, der Treiber liefert Aggregate als Zeichenkette, und
 * der Rebrickable-Katalog schreibt 't'/'f'. Genau deshalb hat nie jemand die
 * Ersatzteil-Plakette gezeichnet, obwohl der Text dafür in beiden Sprachen
 * bereitliegt: Man konnte nicht sagen, was das Feld bedeutet.
 *
 * Und die naheliegende Abkürzung wäre falsch gewesen: Der Server liefert
 * `"0"` als ZEICHENKETTE, und die ist in JavaScript WAHR. Ein `if (p.is_spare)`
 * im Frontend hätte JEDES Teil als Ersatzteil markiert.
 *
 * Deshalb hier, an einer Stelle, grosszügig im Lesen — und die Antworten
 * tragen danach einen echten Wahrheitswert, sodass die Clients gar nichts
 * mehr deuten müssen.
 *
 * Bewusst KEIN strictBool(): Das ist für Eingaben aus Anfragen gedacht und
 * wirft bei Unlesbarem. Hier kommen Werte aus der eigenen Datenbank und aus
 * Fremdkatalogen; ein unbekannter Wert heisst „kein Ersatzteil", nicht
 * „Abbruch der Teileliste".
 */
export function istErsatzteil(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 't' || v === 'true' || v === 'y' || v === 'yes';
}

/**
 * Dieselbe Lesart wie [istErsatzteil], aber als SQL-Ausdruck.
 *
 * Drei Abfragen entscheiden schon in der Datenbank, ob eine Zeile ein
 * Ersatzteil ist — dort kann keine TypeScript-Funktion laufen. Ohne diesen
 * Helfer stuende die Aufzaehlung ein zweites Mal im Baum, in SQL, und genau
 * so ist sie ueberhaupt erst auseinandergelaufen (eine Stelle kannte nur 't').
 *
 * @param spalte Spaltenname, bereits vertrauenswuerdig — es ist NIE ein Wert
 *               aus einer Anfrage, sondern immer ein im Code stehender Name.
 */
export function ersatzteilSql(spalte: string): string {
  return `LOWER(TRIM(${spalte}::text)) IN ('1','t','true','y','yes')`;
}

/**
 * Einen Routen- oder Abfrageparameter als EINEN Text nehmen.
 *
 * ── Warum es das braucht (Nachtrag 132) ─────────────────────────────────────
 *
 * `@types/express@5` typisiert `req.params[x]` als `string | string[]`, und die
 * Abfrageparameter sind es ohnehin: `?accounts=a&accounts=b` liefert zur
 * Laufzeit ein Array. Wer das ungeprüft weiterreicht, bekommt an einer ganz
 * anderen Stelle ein `["a","b"]`, wo eine Setnummer erwartet wird.
 *
 * Aufgefallen ist es erst, als die späten `require()` zu echten `import`
 * wurden: Solange die Zielfunktion über `require()` kam, war sie `any` — und
 * `any` prüft keine Typen. Drei Aufrufstellen meldete tsc sofort.
 *
 * Bei mehreren Werten gewinnt der ERSTE. Das entspricht dem, was die Anwendung
 * bisher faktisch tat, wenn nur ein Wert ankam, und ist die harmlosere Wahl:
 * Ein zusammengefügter Wert („a,b") wäre eine Setnummer, die es nicht gibt.
 */
export function einzelwert(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : fallback;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/**
 * Einen Wert aus einer Nachschlagetabelle holen, wenn der Schlüssel von aussen
 * kommt.
 *
 * ── Warum es diese Funktion braucht (Nachtrag 155) ──────────────────────────
 * `TABELLE[schluessel]` liefert in JavaScript auch GEERBTE Eigenschaften, und
 * die sind wahrheitswertig. Die übliche Absicherung `TABELLE[k] || VORGABE`
 * greift deshalb nicht:
 *
 *     const SORTS = { year_desc: 'rb.year DESC', … };
 *     SORTS['unbekannt']   -> undefined                -> Vorgabe greift
 *     SORTS['constructor'] -> function Object() { … }  -> Vorgabe greift NICHT
 *     SORTS['__proto__']   -> [object Object]          -> Vorgabe greift NICHT
 *
 * Gefunden an drei Stellen, zwei davon tragend:
 *
 *   routes/api_v1/catalog.ts   Das Ergebnis ging direkt in ein ORDER BY. Kein
 *                              freies Einschleusen — den eingesetzten Text kann
 *                              der Aufrufer nicht wählen —, aber ein von aussen
 *                              auslösbarer 500er. Und es WÜRDE zum Einschleusen,
 *                              sobald irgendwo eine Prototype-Pollution dazukäme.
 *   routes/sets.ts             Der Datei-Filter beim Anleitungs-Upload. Mit
 *                              Content-Type: constructor kam beliebiger Inhalt
 *                              an der Zusage "nur PDF, JPG oder PNG" vorbei.
 *   utils/handlers/sets.ts     Dasselbe Muster in der Set-Sortierung.
 *
 * `hasOwnProperty.call` statt `Object.hasOwn`: gleichwertig, aber unabhängig
 * von der lib-Einstellung in tsconfig.
 *
 * @param tabelle    Die erlaubten Werte. Nur EIGENE Schlüssel zählen.
 * @param schluessel Der Schlüssel von aussen — beliebiger Typ, wird zu String.
 * @param vorgabe    Was zurückkommt, wenn der Schlüssel nicht in der Tabelle steht.
 * @returns Der Tabellenwert, sonst `vorgabe`.
 */
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown, vorgabe: T): T;
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown): T | undefined;
export function ausTabelle<T>(
  tabelle: Record<string, T>,
  schluessel: unknown,
  vorgabe?: T,
): T | undefined {
  const k = einzelwert(schluessel);
  return Object.prototype.hasOwnProperty.call(tabelle, k) ? tabelle[k] : vorgabe;
}
