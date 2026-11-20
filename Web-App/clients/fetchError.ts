/**
 * Die Zusatzangaben, die die Abruf-Klienten an ihre Fehler haengen.
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

/** Einen gefangenen Wert als Abruf-Fehler lesen; immer ein Error, damit keine
 * Verzweigung darunter erneut prüfen muss, ob überhaupt ein Objekt vorliegt. */
function asFetchError(e: unknown): AbrufFehler {
  if (e instanceof Error) return e as AbrufFehler;
  // Kein Error: Wir behalten die Zusatzfelder, falls doch welche da sind, und
  // geben der Meldung einen Text, mit dem man etwas anfangen kann.
  const roh = (e ?? {}) as Record<string, unknown>;
  const f = new Error(
    typeof e === 'string' && e
      ? e
      : typeof roh.message === 'string' && roh.message
        ? roh.message
        : 'Unbekannter Abruffehler',
  ) as AbrufFehler;
  if (roh.isQuota) f.isQuota = true;
  if (roh.isTransient) f.isTransient = true;
  if (roh.isCloudflare) f.isCloudflare = true;
  // NonNullable, weil exactOptionalPropertyTypes zwischen „Feld fehlt" und
  // „Feld ist undefined" unterscheidet — die Zuweisung darunter passiert nur,
  // wenn wirklich etwas da ist.
  if (roh.detail) f.detail = roh.detail as NonNullable<AbrufFehler['detail']>;
  return f;
}

export { asFetchError };
export type { AbrufFehler };
