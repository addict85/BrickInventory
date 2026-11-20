/**
 * The extra details the fetch clients attach to their errors.
 */
type AbrufFehler = Error & {
  /** Daily quota of the API key exhausted. */
  isQuota?: boolean;
  /** Temporary — network drop, timeout. Another attempt is worthwhile. */
  isTransient?: boolean;
  /** Cloudflare block (1015). The queue must pause, not retry. */
  isCloudflare?: boolean;
  /** The remote side's response, as far as it was readable. */
  detail?: { meta?: { code?: number } } & Record<string, unknown>;
};

/** Read a caught value as a fetch error; always an Error, so no branch below
 * has to check again whether there is an object at all. */
function asFetchError(e: unknown): AbrufFehler {
  if (e instanceof Error) return e as AbrufFehler;
  // Not an Error: we keep the extra fields in case there are some, and
  // give the message a text one can work with.
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
  // NonNullable, because exactOptionalPropertyTypes distinguishes "field missing" from
  // "field is undefined" — the assignment below only happens
  // when something is really there.
  if (roh.detail) f.detail = roh.detail as NonNullable<AbrufFehler['detail']>;
  return f;
}

export { asFetchError };
export type { AbrufFehler };
