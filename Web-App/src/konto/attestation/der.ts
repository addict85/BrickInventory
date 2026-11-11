/** Ein DER-Leser nur für das, was die Schlüssel-Attestation braucht: Er wirft
 * bei jedem Formfehler, statt zu raten; ein Angreifer bestimmt die Bytes. */

export interface Tlv {
  /** 0 universal, 1 application, 2 kontextspezifisch, 3 privat */
  klasse: number;
  nummer: number;
  zusammengesetzt: boolean;
  inhalt: Buffer;
}

export class DerFehler extends Error {}

const HOECHSTE_NUMMER = 2 ** 21;

/** Ein Element ab [pos]; `ende` zeigt hinter es. */
export function liesTlv(b: Buffer, pos = 0): { tlv: Tlv; ende: number } {
  let p = pos;
  const byte = () => {
    if (p >= b.length) throw new DerFehler('DER: abgeschnitten');
    return b[p++] as number;
  };
  const erstes = byte();
  let nummer = erstes & 0x1f;
  if (nummer === 0x1f) {
    nummer = 0;
    for (let b7 = byte(); ; b7 = byte()) {
      nummer = nummer * 128 + (b7 & 0x7f);
      if (nummer >= HOECHSTE_NUMMER) throw new DerFehler('DER: Tag zu gross');
      if (!(b7 & 0x80)) break;
    }
  }
  let laenge = byte();
  if (laenge === 0x80) throw new DerFehler('DER: unbestimmte Länge');
  if (laenge > 0x80) {
    const n = laenge & 0x7f;
    if (n > 3) throw new DerFehler('DER: Länge zu gross');
    laenge = 0;
    for (let i = 0; i < n; i++) laenge = laenge * 256 + byte();
  }
  if (p + laenge > b.length) throw new DerFehler('DER: Länge über das Ende');
  const tlv = { klasse: erstes >> 6, nummer, zusammengesetzt: !!(erstes & 0x20), inhalt: b.subarray(p, p + laenge) };
  return { tlv, ende: p + laenge };
}

/** Genau ein Element, nichts dahinter. */
export function liesGanz(b: Buffer): Tlv {
  const { tlv, ende } = liesTlv(b);
  if (ende !== b.length) throw new DerFehler('DER: Bytes hinter dem Element');
  return tlv;
}

export function kinder(t: Tlv): Tlv[] {
  if (!t.zusammengesetzt) throw new DerFehler('DER: kein zusammengesetztes Element');
  const liste: Tlv[] = [];
  for (let p = 0; p < t.inhalt.length; ) {
    const { tlv, ende } = liesTlv(t.inhalt, p);
    liste.push(tlv);
    p = ende;
  }
  return liste;
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

export function erwarte(t: Tlv | undefined, nummer: number, klasse = 0): Tlv {
  if (!t || t.nummer !== nummer || t.klasse !== klasse) throw new DerFehler(`DER: Tag ${nummer} erwartet`);
  return t;
}

/** INTEGER oder ENUMERATED, nicht negativ und klein genug für eine Zahl. */
export function derZahl(t: Tlv): number {
  if (t.klasse !== 0 || (t.nummer !== UNIVERSAL.INTEGER && t.nummer !== UNIVERSAL.ENUMERATED))
    throw new DerFehler('DER: keine Zahl');
  if (!t.inhalt.length || (t.inhalt[0] as number) & 0x80) throw new DerFehler('DER: negative oder leere Zahl');
  if (t.inhalt.length > 7) throw new DerFehler('DER: Zahl zu gross');
  return t.inhalt.reduce((n, x) => n * 256 + x, 0);
}
