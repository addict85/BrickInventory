/** A DER reader only for what key attestation needs: it throws
 * on every format error instead of guessing; an attacker determines the bytes. */

export interface Tlv {
  /** 0 universal, 1 application, 2 context-specific, 3 private */
  klasse: number;
  number: number;
  zusammengesetzt: boolean;
  inhalt: Buffer;
}

export class TheError extends Error {}

const HIGHEST_NUMBER = 2 ** 21;

/** An element starting at [pos]; `ende` points behind it. */
export function liesTlv(b: Buffer, pos = 0): { tlv: Tlv; ende: number } {
  let p = pos;
  const byte = () => {
    if (p >= b.length) throw new TheError('DER: abgeschnitten');
    return b[p++] as number;
  };
  const erstes = byte();
  let number = erstes & 0x1f;
  if (number === 0x1f) {
    number = 0;
    for (let b7 = byte(); ; b7 = byte()) {
      number = number * 128 + (b7 & 0x7f);
      if (number >= HIGHEST_NUMBER) throw new TheError('DER: Tag zu gross');
      if (!(b7 & 0x80)) break;
    }
  }
  let length = byte();
  if (length === 0x80) throw new TheError('DER: unbestimmte Länge');
  if (length > 0x80) {
    const n = length & 0x7f;
    if (n > 3) throw new TheError('DER: Länge zu gross');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + byte();
  }
  if (p + length > b.length) throw new TheError('DER: Länge über das Ende');
  const tlv = { klasse: erstes >> 6, number, zusammengesetzt: !!(erstes & 0x20), inhalt: b.subarray(p, p + length) };
  return { tlv, ende: p + length };
}

/** Exactly one element, nothing behind it. */
export function readWhole(b: Buffer): Tlv {
  const { tlv, ende } = liesTlv(b);
  if (ende !== b.length) throw new TheError('DER: Bytes hinter dem Element');
  return tlv;
}

export function kinder(t: Tlv): Tlv[] {
  if (!t.zusammengesetzt) throw new TheError('DER: kein zusammengesetztes Element');
  const list: Tlv[] = [];
  for (let p = 0; p < t.inhalt.length; ) {
    const { tlv, ende } = liesTlv(t.inhalt, p);
    list.push(tlv);
    p = ende;
  }
  return list;
}

export const UNIVERSAL = {
  BOOLEAN: 1,
  INTEGER: 2,
  OCTET_STRING: 4,
  NULL: 5,
  OID: 6,
  ENUMERATED: 10,
  SEQUENCE: 16,
  SET: 17,
};

export function expect(t: Tlv | undefined, number: number, kind = 0): Tlv {
  if (!t || t.number !== number || t.klasse !== kind) throw new TheError(`DER: Tag ${number} erwartet`);
  return t;
}

/** INTEGER or ENUMERATED, not negative and small enough for a number. */
export function theNumber(t: Tlv): number {
  if (t.klasse !== 0 || (t.number !== UNIVERSAL.INTEGER && t.number !== UNIVERSAL.ENUMERATED))
    throw new TheError('DER: keine Zahl');
  if (!t.inhalt.length || (t.inhalt[0] as number) & 0x80) throw new TheError('DER: negative oder leere Zahl');
  if (t.inhalt.length > 7) throw new TheError('DER: Zahl zu gross');
  return t.inhalt.reduce((n, x) => n * 256 + x, 0);
}
