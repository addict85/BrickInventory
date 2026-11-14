/** Eine Regel für drei Arten, damit Webapp und App nicht auseinanderlaufen. */
import { geldEingabe } from '../infra/geld';
import * as repo from './repository/erfassungen';
import type { Sicht } from '../haushalt';
import { Abstriche } from '../infra/ergebnis';
import { bestandsSchluessel } from '../../db/txLock';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import { mengeDesSets, mengeDerPosition, preisSpalte, type ErfassungsArt } from '../../db/bestandsmenge';
import { bestandsMenge, zustand } from '../infra/validate';
import type { SammlungKontext } from './kontext';

export type { ErfassungsArt } from '../../db/bestandsmenge';
type Schluessel = Array<string | number>;

interface Art {
  notFound: FehlerCode;
  /** Im Zustand dieser Zeile, wenn der Preis geleert wird. */
  resolvePrice: (uid: number, keys: Schluessel, cond: string | null) => Promise<number | null>;
  /** In der Transaktion: `t` ist ihr Kontext. */
  cleanupWhenEmpty: (t: SammlungKontext, ownerId: number, keys: Schluessel) => Promise<unknown>;
}

const arten = (k: SammlungKontext): Record<ErfassungsArt, Art> => ({
  set: {
    notFound: 'erfassung_nicht_gefunden',
    resolvePrice: (uid, [sn], cond) => k.finanzen.getCurrentMarketPrice(String(sn), uid, cond || null),
    // Wie beim ausdrücklichen Löschen: Teile und Figuren des Sets stünden sonst
    // ohne Set in Teileliste und Finanzsummen.
    cleanupWhenEmpty: (t, ownerId, [sn]) => t.sets.setZeilenLoeschen([ownerId], String(sn)),
  },
  part: {
    notFound: 'nicht_gefunden',
    resolvePrice: (uid, [pn, cid], cond) => k.finanzen.getCurrentPartMarketPrice(String(pn), Number(cid), uid, cond),
    // Nur die manuelle Position; Set-Teile gehen mit ihrem Set.
    cleanupWhenEmpty: (t, ownerId, [pn, cid]) => t.bestand.loescheManuellesTeil(ownerId, String(pn), Number(cid)),
  },
  fig: {
    notFound: 'nicht_gefunden',
    resolvePrice: async (uid, [fn], cond) =>
      k.finanzen.getCurrentFigMarketPrice(String(fn), uid, await k.katalog.blAbrufNummer('fig', String(fn), uid), cond),
    cleanupWhenEmpty: (t, ownerId, [fn]) => t.bestand.loescheManuelleFigur(ownerId, String(fn)),
  },
});

interface Zeile {
  id: number;
  user_id: number;
  condition: string | null;
  preis: number | null;
  price_estimated: boolean;
  currency: string;
  tag: string;
}

/** Nur für den Sperrschlüssel; die Rechte prüft danach die Abfrage im Schreib-Blickfeld. */
async function besitzerDerZeile(k: SammlungKontext, art: ErfassungsArt, id: number, fallback: number): Promise<number> {
  return (await k.erfassungen.kontoDerErfassung(art, id)) ?? fallback;
}

/** 0 heisst „leer", null „keine Zeile"; beides räumt auf. Ein Lesefehler ist
 * keins von beiden und geht weiter: In der Transaktion ist danach jeder Befehl
 * verloren (25P02), ein Ersatz hätte die Ursache verdeckt. */
function mengeDesBestands(
  t: SammlungKontext,
  art: ErfassungsArt,
  ownerId: number,
  keys: Schluessel,
): Promise<number | null> {
  return art === 'set' ? mengeDesSets(ownerId, String(keys[0]), t.db) : mengeDerPosition(art, ownerId, keys, t.db);
}
const leer = (q: number | null) => q === null || q <= 0;

/** Schreib-Blickfeld: Ein Unterkonto darf nicht rückwärts schreiben. */
async function zeileImSchreibfeld(
  t: SammlungKontext,
  art: ErfassungsArt,
  wids: number[],
  id: number,
  keys: Schluessel,
): Promise<Zeile> {
  const a = arten(t)[art];
  const z = await repo.erfassungImSchreibfeld(t.db, art, id, wids, keys);
  if (!z) fachfehler('nicht_gefunden', a.notFound);
  return z;
}

async function antwort(
  k: SammlungKontext,
  art: ErfassungsArt,
  uid: number,
  keys: Schluessel,
  payload: Record<string, unknown>,
) {
  return art === 'set' ? k.sets.mitSetAggregat(uid, String(keys[0]), payload) : payload;
}

export interface Aenderung {
  quantity?: unknown;
  condition?: unknown;
  date?: unknown;
  owner_user_id?: unknown;
  [preis: string]: unknown;
}

export async function erfassungAendern(
  k: SammlungKontext,
  art: ErfassungsArt,
  uid: number,
  id: number,
  keys: Schluessel,
  body: Aenderung,
) {
  const a = arten(k)[art];
  const { quantity, condition, date } = body;
  const rawPrice = body[preisSpalte(art)];

  const ownerReq = body.owner_user_id;
  if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '') {
    const from = await k.haushalt.umzugsQuelle(uid, art, id);
    const to = await k.haushalt.schreibzielOderNull(uid, ownerReq);
    if (to === null) fachfehler('verboten', 'kein_schreibrecht');
    if (from === to) return { unchanged: true };
    // Wie setVerschieben(): Gegenrichtungen sperren die Zeilen beider Konten umgekehrt.
    const moved = await k.transaktion(
      t =>
        art === 'set'
          ? t.sets.setErfassungenUmhaengen(String(keys[0]), from, to, [id])
          : t.sets.manuelleErfassungUmhaengen(art, keys, id, from, to),
      { sperren: [{ konto: from, schluessel: bestandsSchluessel(art, keys) }], wiederholeBeiKonflikt: true },
    );
    return { from_user_id: from, to_user_id: to, ...moved };
  }

  // Der Marktpreis-Rückfall vor der Transaktion, sonst hielte ein Netzaufruf
  // Sperre und Verbindung offen.
  let priceVal: number | null = null;
  let preisGeschaetzt = false;
  // Kam der Marktpreis nicht, bleibt der Preis leer; die Antwort sagt es in `degradiert`.
  const ab = new Abstriche();
  if (rawPrice !== undefined) {
    let p = geldEingabe(rawPrice, preisSpalte(art) === 'purchase_price' ? 'Kaufpreis' : 'Stückpreis');
    if (p === null) {
      preisGeschaetzt = true;
      const bisher = condition ? null : await k.erfassungen.zustandDerErfassung(art, id);
      p = await ab.oder('marktpreis', a.resolvePrice(uid, keys, String(condition || bisher || '') || null), null);
    }
    priceVal = p;
  }

  const besitzer = await besitzerDerZeile(k, art, id, uid);
  await k.transaktion(
    async t => {
      const wids = await t.haushalt.schreibbereich(uid);
      const acq = await zeileImSchreibfeld(t, art, wids, id, keys);
      // Ab hier zählt der Besitzer der Zeile, nicht der Betrachter.
      const ownerId = Number(acq.user_id);
      let neuesDatum: string | null = null;
      if (date !== undefined && date !== null && date !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fachfehler('ungueltig', 'datum_ungueltig');
        neuesDatum = String(date);
      }
      const hatZustand = condition !== undefined && condition !== null;
      const zielZustand = hatZustand ? zustand(condition) : acq.condition || 'N';
      const zielGeschaetzt = rawPrice !== undefined ? preisGeschaetzt && priceVal != null : !!acq.price_estimated;
      // Geprüft gegen die Werte NACH dieser Änderung.
      if (neuesDatum || rawPrice !== undefined || hatZustand) {
        const clash = await t.bestand.findSameDayAcquisition(
          art,
          ownerId,
          keys,
          neuesDatum || acq.tag,
          id,
          zielZustand,
          {
            preis: rawPrice !== undefined ? priceVal : acq.preis,
            geschaetzt: zielGeschaetzt,
            waehrung: acq.currency,
          },
        );
        if (clash) fachfehler('konflikt', 'datum_belegt');
      }
      if (quantity !== undefined && quantity !== null) {
        await repo.setzeErfassungsMenge(t.db, art, id, bestandsMenge(quantity, 1), wids);
        const q = await mengeDesBestands(t, art, ownerId, keys);
        if (leer(q)) await a.cleanupWhenEmpty(t, ownerId, keys);
      }
      if (rawPrice !== undefined) await repo.setzeErfassungsPreis(t.db, art, id, priceVal, zielGeschaetzt, wids);
      if (hatZustand) await repo.setzeErfassungsZustand(t.db, art, id, zielZustand, wids);
      if (neuesDatum) await repo.setzeErfassungsDatum(t.db, art, id, neuesDatum, wids);
    },
    { sperren: [{ konto: besitzer, schluessel: bestandsSchluessel(art, keys) }] },
  );
  return antwort(k, art, uid, keys, { ...ab.angabe() });
}

/** Ist danach nichts mehr da, geht die Bestandszeile mit. */
export async function erfassungLoeschen(
  k: SammlungKontext,
  art: ErfassungsArt,
  uid: number,
  id: number,
  keys: Schluessel,
) {
  const a = arten(k)[art];
  const besitzer = await besitzerDerZeile(k, art, id, uid);
  const menge = await k.transaktion(
    async t => {
      const acq = await zeileImSchreibfeld(t, art, await t.haushalt.schreibbereich(uid), id, keys);
      const ownerId = Number(acq.user_id);
      await repo.loescheErfassung(t.db, art, id, ownerId);
      const q = await mengeDesBestands(t, art, ownerId, keys);
      if (leer(q)) await a.cleanupWhenEmpty(t, ownerId, keys);
      return q;
    },
    { sperren: [{ konto: besitzer, schluessel: bestandsSchluessel(art, keys) }] },
  );
  return antwort(k, art, uid, keys, { new_quantity: menge ?? 0 });
}

export async function setErfassungen(k: SammlungKontext, sicht: Sicht | number[], setNumber: string) {
  return k.erfassungen.setErfassungenImBlickfeld(await k.haushalt.blickfeldAus(sicht), setNumber);
}
