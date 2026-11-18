/** A single account's vouchers: creating (also from a PDF), changing, deleting,
 * releases and balance. A refusal is a business error; the route only picks
 * the response. */
import fs from 'node:fs';
import path from 'node:path';
import { Fachfehler, alsDoppelt, fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import { ohneFehlendeDatei } from '../infra/fehler';
import type { VoucherRow } from './repository/vouchers';
import { VOUCHER_DIR, voucherFile, readVoucherPdf, readVoucherPdfOrNothing, writeVoucherPdf } from './voucherFiles';
import { countryAllowed, countryForCurrency } from './balanceLookup';
import { checkBalanceThrottled, type Locked } from './balanceThrottle';
import type { ParsedVoucher } from './pdfParsing';
import { combineVouchers } from './pdfExport';
import { issueTicket } from './pdfTicket';
import { MAX_PAGES, readInBackground } from './pdfReader';
import type { VoucherContext } from './context';
import { PIN_MASKE, gutscheinNummer, gutscheinPin, gutscheinWaehrung, nummerMaske } from '../infra/gutscheinWerte';

export type { VoucherRow } from './repository/vouchers';

export { PIN_MASKE } from '../infra/gutscheinWerte';

export const maskiert = (z: { number: string; pin: string | null }) => ({
  number: nummerMaske(z.number),
  pin: z.pin ? PIN_MASKE : null,
});

type Checked = { number: string; pin: string | null; amount: number; currency: string | null };
/** What the contract has already checked (src/vertrag/gutscheine.ts): the format of
 * number, PIN and currency. */
export interface NewVoucher {
  number: string;
  pin?: string | null | undefined;
  amount: number | null | undefined;
  currency?: string | null | undefined;
}

/** The amount is a business rule, not a format: a zero would otherwise create a
 * voucher over nothing. */
function amountRule(raw: number | null | undefined, zeroAllowed = false): number {
  const amount = raw ?? Number.NaN;
  if (!Number.isFinite(amount) || amount > 1_000_000 || (zeroAllowed ? amount < 0 : amount <= 0))
    fachfehler('ungueltig', 'betrag_ungueltig');
  return amount;
}

const checked = (w: NewVoucher, zeroAllowed = false): Checked => ({
  number: w.number,
  pin: w.pin ?? null,
  amount: amountRule(w.amount, zeroAllowed),
  currency: w.currency ?? null,
});

type Raw = { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown };

/** Only for values the server reads from a PDF itself: input is checked by the contract. */
export function pruefeWerte(roh: Raw): ({ ok: true } & Checked) | { ok: false; code: FehlerCode } {
  try {
    return {
      ok: true,
      number: gutscheinNummer(roh.number == null ? '' : String(roh.number)),
      pin: gutscheinPin(roh.pin == null ? null : String(roh.pin)),
      // Number('') is 0 and fails the amount check.
      amount: amountRule(Number(roh.amount)),
      currency: gutscheinWaehrung(roh.currency == null ? null : String(roh.currency)),
    };
  } catch (e) {
    if (e instanceof Fachfehler) return { ok: false, code: e.code };
    throw e;
  }
}

const repo = (k: VoucherContext) => k.vouchers;

export function voucherList(k: VoucherContext, uid: number, order?: 'neueste' | 'aelteste') {
  return repo(k).vouchersOfAccount(uid, order);
}

async function existing(k: VoucherContext, uid: number, id: number): Promise<VoucherRow> {
  return (await repo(k).voucher(uid, id)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
}

/** No row means "already there" — as a success, the user would see nothing happen. */
export async function createVoucher(k: VoucherContext, uid: number, e: NewVoucher): Promise<VoucherRow> {
  return (await repo(k).createVoucher(uid, checked(e))) ?? fachfehler('konflikt', 'gutschein_existiert');
}

/** The batch case of a bundle PDF: what already exists gets replaced. */
export async function batchCreate(k: VoucherContext, uid: number, found: ParsedVoucher[]) {
  let added = 0,
    updated = 0,
    errors = 0;
  const results: { number: string; action: string; error?: string }[] = [];
  for (const g of found) {
    const w = pruefeWerte({ number: g.number, pin: g.pin, amount: g.amount, currency: g.currency });
    if (!w.ok) {
      errors++;
      results.push({ number: String(g.number ?? ''), action: 'error', error: w.code });
      continue;
    }
    const wasNew = await repo(k).replaceVoucher(uid, w);
    if (wasNew) added++;
    else updated++;
    results.push({ number: w.number, action: wasNew ? 'added' : 'updated' });
  }
  return { added, updated, errors, total: found.length, results };
}

/** Row and file together or not at all: the file is created inside the transaction
 * before the COMMIT, and falls away again if anything fails after that. Otherwise
 * a row would be left without a PDF, or an encrypted PDF without a row. */
export async function createVoucherWithPdf(
  k: VoucherContext,
  uid: number,
  w: Checked,
  pdf: Buffer,
): Promise<VoucherRow> {
  const written: string[] = [];
  try {
    return await k.transaktion(async t => {
      const z = (await repo(t).createVoucher(uid, w)) ?? fachfehler('konflikt', 'gutschein_existiert');
      // File name from the ID, not from the upload: a name from the client would have
      // to be checked against path components.
      const relPath = `${uid}/${z.id}.pdf`;
      written.push(path.join(VOUCHER_DIR, relPath));
      await writeVoucherPdf(written[0]!, pdf);
      await repo(t).rememberVoucherPdf(uid, z.id, relPath);
      return { ...z, pdf_path: relPath };
    });
  } catch (e) {
    for (const file of written) await fs.promises.unlink(file).catch(ohneFehlendeDatei('gutschein:pdf zurücknehmen'));
    throw e;
  }
}

export type AusPdf =
  | { art: 'stapel'; bericht: Awaited<ReturnType<typeof batchCreate>> }
  | { art: 'angelegt'; zeile: VoucherRow; gelesen: ParsedVoucher };

/** The form fields: how the frontend prefills them after a rejection. */
export const alsGelesen = (g: ParsedVoucher) => ({
  number: g.number,
  pin: g.pin,
  currency: g.currency,
  ...(g.amount == null ? {} : { amount: g.amount }),
});

const NOTHING_READ: ParsedVoucher = { number: null, pin: null, amount: null, currency: null };

/** One path for both apps: typed fields win over what was read. Only from two pages
 * on does it become a batch; with one, the 422 contract of the forms still applies. */
export async function voucherFromPdf(
  k: VoucherContext,
  uid: number,
  pdf: Buffer,
  typed: VoucherChange,
): Promise<AusPdf> {
  const reading = await readInBackground(pdf);
  if (reading.art === 'zu_viele_seiten')
    fachfehler('nicht_verarbeitbar', 'pdf_zu_viele_seiten', { seiten: reading.seiten, max: MAX_PAGES });
  if (reading.art === 'unlesbar') fachfehler('nicht_verarbeitbar', 'pdf_unlesbar');
  if (reading.stapel.length >= 2) return { art: 'stapel', bericht: await batchCreate(k, uid, reading.stapel) };
  // The media type is a claim by the client: what is checked is the signature, since
  // the file goes out later as application/pdf. A decompression bomb would otherwise
  // reach pdf-lib, which unpacks without a limit.
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || reading.einzeln === 'zu_gross')
    fachfehler('nicht_verarbeitbar', 'pdf_unlesbar');
  const read = typeof reading.einzeln === 'object' ? reading.einzeln : NOTHING_READ;
  const raw = {
    number: typed.number ?? read.number,
    pin: typed.pin ?? read.pin,
    amount: typed.amount ?? read.amount,
    currency: typed.currency ?? read.currency,
  };
  const w = pruefeWerte(raw);
  if (w.ok) return { art: 'angelegt', zeile: await createVoucherWithPdf(k, uid, w, pdf), gelesen: read };
  // Three rejections, because the user has to do something different for each.
  const nothingTyped = !typed.number && !typed.pin && !typed.amount;
  const nothingRead = read.number == null && read.amount == null;
  const code: FehlerCode =
    reading.einzeln === 'fehler' ? 'pdf_unlesbar' : nothingRead && nothingTyped ? 'kein_gutschein_im_pdf' : w.code;
  // 422: the request was fine, only the PDF did not give up everything; `gelesen` prefills the fields.
  throw new Fachfehler('nicht_verarbeitbar', code, undefined, { gelesen: alsGelesen(read) });
}

export interface VoucherChange {
  number?: string | undefined;
  pin?: string | null | undefined;
  amount?: number | null | undefined;
  currency?: string | null | undefined;
}

/** Read, merge, write under the row lock: two simultaneous changes to different
 * fields would otherwise lose one. What does not come along, or comes back
 * masked, stays as it was: the form only knows the mask. */
export function changeVoucher(
  k: VoucherContext,
  uid: number,
  id: number,
  e: VoucherChange,
): Promise<VoucherRow> {
  return k
    .transaktion(async t => {
      const old = (await repo(t).lockedVoucher(uid, id)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
      const mask = maskiert(old);
      const w = checked(
        {
          number: e.number === undefined || e.number === mask.number ? old.number : e.number,
          pin: e.pin === PIN_MASKE ? old.pin : e.pin === '' ? null : (e.pin ?? old.pin),
          amount: e.amount ?? Number(old.amount),
          currency: e.currency === '' ? null : (e.currency ?? old.currency),
        },
        e.amount === undefined,
      );
      return (await repo(t).changeVoucher(uid, id, w)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
    })
    .catch(alsDoppelt('gutschein_existiert'));
}

/** Row first, then the file: better an orphaned file than a row pointing nowhere. */
export async function deleteVoucher(k: VoucherContext, uid: number, id: number): Promise<void> {
  const pdfPath = await repo(k).deleteVoucher(uid, id);
  if (pdfPath === undefined) fachfehler('nicht_gefunden', 'nicht_gefunden');
  const file = pdfPath ? voucherFile(uid, pdfPath) : null;
  if (file) await fs.promises.unlink(file).catch(ohneFehlendeDatei('gutschein:pdf löschen'));
}

export async function voucherPlaintext(k: VoucherContext, uid: number, id: number): Promise<VoucherRow> {
  const z = await existing(k, uid, id);
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_klartext', maskiert(z).number);
  return z;
}

/** The PDFs carry number and PIN: log first, then a ticket for exactly one fetch. */
export async function releasePdf(k: VoucherContext, uid: number, id: number): Promise<string> {
  const z = await existing(k, uid, id);
  if (!z.pdf_path) fachfehler('nicht_gefunden', 'nicht_gefunden');
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_pdf', maskiert(z).number);
  return issueTicket(k, uid, String(id));
}

export async function releaseExport(k: VoucherContext, uid: number): Promise<string> {
  const n = (await voucherList(k, uid)).length;
  if (!n) fachfehler('nicht_gefunden', 'keine_gutscheine');
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_export', `${n}`);
  return issueTicket(k, uid, 'export');
}

export async function voucherPdf(k: VoucherContext, uid: number, id: number): Promise<Buffer> {
  const z = await existing(k, uid, id);
  const file = z.pdf_path ? voucherFile(uid, z.pdf_path) : null;
  const pdf = file ? await readVoucherPdf(file).catch(ohneFehlendeDatei('gutschein:pdf lesen', null)) : null;
  return pdf ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
}

/** A missing file does not abort the export, otherwise it would take every other voucher with it. */
export async function exportVouchers(k: VoucherContext, uid: number) {
  const rows = await voucherList(k, uid, 'aelteste');
  if (!rows.length) fachfehler('nicht_gefunden', 'keine_gutscheine');
  const vouchers = [];
  for (const z of rows)
    vouchers.push({
      id: z.id,
      number: z.number,
      pin: z.pin,
      amount: Number(z.amount),
      currency: z.currency,
      pdf: z.pdf_path ? await readVoucherPdfOrNothing(voucherFile(uid, z.pdf_path)) : null,
    });
  return combineVouchers(vouchers);
}

export type BalanceResult =
  | ({ art: 'gesperrt' } & Locked)
  | { art: 'guthaben'; zeile: VoucherRow; angezeigt: string | null; waehrungGeaendert: boolean };

/** It checks the PIN and the country BEFORE the throttle: a call that cannot
 * succeed should not use up the one slot per 30 seconds for everyone. The
 * country applies to the whole installation, because a card is only valid in
 * the shop of its issuing country. */
export async function checkBalance(k: VoucherContext, uid: number, id: number): Promise<BalanceResult> {
  const old = await existing(k, uid, id);
  if (!old.pin) fachfehler('ungueltig', 'guthaben_pin_fehlt');
  const country = String(
    (await k.einstellungen.globalerWert('gutschein_land', '')) ||
      countryForCurrency(await k.einstellungen.nutzerWert(uid, 'currency', 'EUR')),
  );
  if (!countryAllowed(country)) fachfehler('ungueltig', 'guthaben_land_ungueltig');
  const result = await checkBalanceThrottled(k, uid, old.number, old.pin, { locale: country });
  if (result.art === 'gesperrt') return result;
  const g = result.guthaben;
  // The other side's currency wins; a useless value would otherwise ruin the list's total.
  const currency = /^[A-Z]{3}$/.test(g.currency) ? g.currency : old.currency;
  const zeile =
    (await repo(k).rememberBalance(uid, id, g.amount, currency)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
  return { art: 'guthaben', zeile, angezeigt: g.formatted, waehrungGeaendert: currency !== old.currency };
}
