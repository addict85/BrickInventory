/**
 * Die Zusatzangaben, die die Abruf-Klienten an ihre Fehler haengen.
 *
 * ── Warum es diesen Typ gibt ────────────────────────────────────────────────
 * brickset.ts und bricklink.ts reichern geworfene Fehler seit Langem an:
 * `err.isTransient = true` bei einem Netzabbruch, `isQuota` beim
 * Tageskontingent, `isCloudflare` bei einer 1015-Sperre, `detail` mit der
 * Antwort der Gegenstelle. Die Empfaenger — dieselben Dateien und
 * jobs/instructionQueue.ts — verzweigen danach.
 *
 * Diese Verstaendigung war nirgends aufgeschrieben. Sie funktionierte nur,
 * weil der gefangene Wert `any` war: Jeder Tippfehler (`isCloudFlare`) haette
 * still `undefined` ergeben und den Zweig lautlos uebersprungen — bei einer
 * Cloudflare-Sperre heisst das, dass die Warteschlange NICHT pausiert und
 * weiter gegen eine geschlossene Tuer laeuft.
 *
 * Jetzt steht die Verstaendigung an einer Stelle, und der Uebersetzer prueft
 * die Feldnamen.
 */
type AbrufFehler = Error & {
  /** Tageskontingent des API-Schluessels erschoepft. */
  isQuota?: boolean;
  /** Voruebergehend — Netzabbruch, Zeitueberschreitung. Ein erneuter Versuch lohnt. */
  isTransient?: boolean;
  /** Cloudflare-Sperre (1015). Die Warteschlange muss pausieren, nicht wiederholen. */
  isCloudflare?: boolean;
  /** Die Antwort der Gegenstelle, soweit sie lesbar war. */
  detail?: { meta?: { code?: number } } & Record<string, unknown>;
};

/**
 * Einen gefangenen Wert als Abruf-Fehler lesen.
 *
 * Gibt IMMER ein Error-artiges Objekt zurueck, auch wenn etwas anderes
 * geworfen wurde — sonst muesste jede Verzweigung darunter erneut pruefen, ob
 * ueberhaupt ein Objekt vorliegt. Die Zusatzfelder sind optional; ein `false`
 * und ein fehlendes Feld sind fuer jede Verzweigung dasselbe.
 */
function alsAbrufFehler(e: unknown): AbrufFehler {
  if (e instanceof Error) return e as AbrufFehler;
  // Kein Error: Wir behalten die Zusatzfelder, falls doch welche da sind, und
  // geben der Meldung einen Text, mit dem man etwas anfangen kann.
  const roh = (e ?? {}) as Record<string, unknown>;
  const f = new Error(
    typeof e === 'string' && e ? e
    : typeof roh.message === 'string' && roh.message ? roh.message
    : 'Unbekannter Abruffehler'
  ) as AbrufFehler;
  if (roh.isQuota)      f.isQuota = true;
  if (roh.isTransient)  f.isTransient = true;
  if (roh.isCloudflare) f.isCloudflare = true;
  // NonNullable, weil exactOptionalPropertyTypes zwischen „Feld fehlt" und
  // „Feld ist undefined" unterscheidet — die Zuweisung darunter passiert nur,
  // wenn wirklich etwas da ist.
  if (roh.detail)       f.detail = roh.detail as NonNullable<AbrufFehler['detail']>;
  return f;
}

export { alsAbrufFehler };
export type { AbrufFehler };
