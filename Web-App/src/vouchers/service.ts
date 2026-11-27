/** A single account's vouchers: creating (also from a PDF), changing, deleting,
 * releases and balance. A refusal is a business error; the route only picks
 * the response. */
import fs from 'node:fs';
import path from 'node:path';
import { DomainError, asDuplicate, failDomain, type ErrorCode } from '../infra/errorTexts';
import { withoutMissingFile } from '../infra/error';
import type { VoucherRow } from './repository/vouchers';
import { VOUCHER_DIR, voucherFile, readVoucherPdf, readVoucherPdfOrNothing, writeVoucherPdf } from './voucherFiles';
import { countryAllowed, countryForCurrency } from './balanceLookup';
import { checkBalanceThrottled, type Locked } from './balanceThrottle';
import type { ParsedVoucher } from './pdfParsing';
import { combineVouchers } from './pdfExport';
import { issueTicket } from './pdfTicket';
import { MAX_PAGES, readInBackground } from './pdfReader';
import type { VoucherContext } from './context';
import { PIN_MASK, voucherNumber, voucherPin, voucherCurrency, numberMask } from '../infra/voucherValues';
import { fillTemplate } from './templatePdf';

export type { VoucherRow } from './repository/vouchers';

export { PIN_MASK } from '../infra/voucherValues';

export const masked = (z: { number: string; pin: string | null }) => ({
  number: numberMask(z.number),
  pin: z.pin ? PIN_MASK : null,
});

type Checked = { number: string; pin: string | null; amount: number; currency: string | null };
/** What the contract has already checked (src/contract/vouchers.ts): the format of
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
    failDomain('invalid', 'amount_invalid');
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
export function checkValues(raw: Raw): ({ ok: true } & Checked) | { ok: false; code: ErrorCode } {
  try {
    return {
      ok: true,
      number: voucherNumber(raw.number == null ? '' : String(raw.number)),
      pin: voucherPin(raw.pin == null ? null : String(raw.pin)),
      // Number('') is 0 and fails the amount check.
      amount: amountRule(Number(raw.amount)),
      currency: voucherCurrency(raw.currency == null ? null : String(raw.currency)),
    };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code };
    throw e;
  }
}

const repo = (k: VoucherContext) => k.vouchers;

export function voucherList(k: VoucherContext, uid: number, order?: 'neueste' | 'aelteste') {
  return repo(k).vouchersOfAccount(uid, order);
}

async function existing(k: VoucherContext, uid: number, id: number): Promise<VoucherRow> {
  return (await repo(k).voucher(uid, id)) ?? failDomain('not_found', 'not_found');
}

/** No row means "already there" — as a success, the user would see nothing happen. */
export async function createVoucher(k: VoucherContext, uid: number, e: NewVoucher): Promise<VoucherRow> {
  return (await repo(k).createVoucher(uid, checked(e))) ?? failDomain('conflict', 'voucher_exists');
}

/** The batch case of a bundle PDF: what already exists gets replaced. */
export async function batchCreate(k: VoucherContext, uid: number, found: ParsedVoucher[]) {
  let added = 0,
    updated = 0,
    errors = 0;
  const results: { number: string; action: string; error?: string }[] = [];
  for (const g of found) {
    const w = checkValues({ number: g.number, pin: g.pin, amount: g.amount, currency: g.currency });
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
    return await k.transact(async t => {
      const z = (await repo(t).createVoucher(uid, w)) ?? failDomain('conflict', 'voucher_exists');
      // File name from the ID, not from the upload: a name from the client would have
      // to be checked against path components.
      const relPath = `${uid}/${z.id}.pdf`;
      written.push(path.join(VOUCHER_DIR, relPath));
      await writeVoucherPdf(written[0]!, pdf);
      await repo(t).rememberVoucherPdf(uid, z.id, relPath);
      return { ...z, pdf_path: relPath };
    });
  } catch (e) {
    for (const file of written) await fs.promises.unlink(file).catch(withoutMissingFile('gutschein:pdf zurücknehmen'));
    throw e;
  }
}

export type FromPdf =
  | { kind: 'stapel'; report: Awaited<ReturnType<typeof batchCreate>> }
  | { kind: 'angelegt'; row: VoucherRow; parsed: ParsedVoucher };

/** The form fields: how the frontend prefills them after a rejection. */
export const readAs = (g: ParsedVoucher) => ({
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
): Promise<FromPdf> {
  const reading = await readInBackground(pdf);
  if (reading.kind === 'zu_viele_seiten')
    failDomain('unprocessable', 'pdf_too_many_pages', { pages: reading.pages, max: MAX_PAGES });
  if (reading.kind === 'unlesbar') failDomain('unprocessable', 'pdf_unreadable');
  if (reading.batch.length >= 2) return { kind: 'stapel', report: await batchCreate(k, uid, reading.batch) };
  // The media type is a claim by the client: what is checked is the signature, since
  // the file goes out later as application/pdf. A decompression bomb would otherwise
  // reach pdf-lib, which unpacks without a limit.
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || reading.single === 'too_large')
    failDomain('unprocessable', 'pdf_unreadable');
  const read = typeof reading.single === 'object' ? reading.single : NOTHING_READ;
  const raw = {
    number: typed.number ?? read.number,
    pin: typed.pin ?? read.pin,
    amount: typed.amount ?? read.amount,
    currency: typed.currency ?? read.currency,
  };
  const w = checkValues(raw);
  if (w.ok) return { kind: 'angelegt', row: await createVoucherWithPdf(k, uid, w, pdf), parsed: read };
  // Three rejections, because the user has to do something different for each.
  const nothingTyped = !typed.number && !typed.pin && !typed.amount;
  const nothingRead = read.number == null && read.amount == null;
  const code: ErrorCode =
    reading.single === 'fehler' ? 'pdf_unreadable' : nothingRead && nothingTyped ? 'no_voucher_in_pdf' : w.code;
  // 422: the request was fine, only the PDF did not give up everything; `gelesen` prefills the fields.
  throw new DomainError('unprocessable', code, undefined, { parsed: readAs(read) });
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
export function changeVoucher(k: VoucherContext, uid: number, id: number, e: VoucherChange): Promise<VoucherRow> {
  return k
    .transact(async t => {
      const old = (await repo(t).lockedVoucher(uid, id)) ?? failDomain('not_found', 'not_found');
      const mask = masked(old);
      const w = checked(
        {
          number: e.number === undefined || e.number === mask.number ? old.number : e.number,
          pin: e.pin === PIN_MASK ? old.pin : e.pin === '' ? null : (e.pin ?? old.pin),
          amount: e.amount ?? Number(old.amount),
          currency: e.currency === '' ? null : (e.currency ?? old.currency),
        },
        e.amount === undefined,
      );
      return (await repo(t).changeVoucher(uid, id, w)) ?? failDomain('not_found', 'not_found');
    })
    .catch(asDuplicate('voucher_exists'));
}

/** How long a deleted voucher can be restored; the hourly cleanup removes it afterwards. */
export const RESTORE_DAYS = 7;
const restoreWindowStart = (k: VoucherContext) => k.clock.now() - RESTORE_DAYS * 86_400_000;

/** Marks only: row and PDF stay for the undo (restoreVoucher) until the cleanup. */
export async function deleteVoucher(k: VoucherContext, uid: number, id: number): Promise<void> {
  if (!(await repo(k).markDeleted(uid, id, k.clock.now()))) failDomain('not_found', 'not_found');
}

/** The same number entered again in the meantime wins: restoring would make it twice. */
export async function restoreVoucher(k: VoucherContext, uid: number, id: number): Promise<VoucherRow> {
  return (
    (await repo(k).restore(uid, id, restoreWindowStart(k)).catch(asDuplicate('voucher_exists'))) ??
    failDomain('not_found', 'not_found')
  );
}

/** Row first, then the file: better an orphaned file than a row pointing nowhere. */
export async function purgeDeletedVouchers(k: VoucherContext): Promise<number> {
  const rows = await repo(k).purgeDeleted(restoreWindowStart(k));
  for (const z of rows) {
    const file = z.pdf_path ? voucherFile(z.user_id, z.pdf_path) : null;
    if (file) await fs.promises.unlink(file).catch(withoutMissingFile('gutschein:pdf löschen'));
  }
  return rows.length;
}

export async function voucherPlaintext(k: VoucherContext, uid: number, id: number): Promise<VoucherRow> {
  const z = await existing(k, uid, id);
  await k.account.admin.rememberAdminAction(uid, uid, 'voucher_plaintext', masked(z).number);
  return z;
}

/** The PDFs carry number and PIN: log first, then a ticket for exactly one fetch. Without
 * `id` the ticket is for the export of all cards (as pdfRelease in the app). */
export async function releasePdf(k: VoucherContext, uid: number, id: number | null): Promise<string> {
  if (id === null) {
    const n = (await voucherList(k, uid)).length;
    if (!n) failDomain('not_found', 'no_vouchers');
    await k.account.admin.rememberAdminAction(uid, uid, 'voucher_export', `${n}`);
    return issueTicket(k, uid, 'export');
  }
  // Every voucher has a PDF: without an original, voucherPdf() fills the LEGO template.
  const z = await existing(k, uid, id);
  await k.account.admin.rememberAdminAction(uid, uid, 'voucher_pdf', masked(z).number);
  return issueTicket(k, uid, String(id));
}

export async function voucherPdf(k: VoucherContext, uid: number, id: number): Promise<Buffer> {
  const z = await existing(k, uid, id);
  const file = z.pdf_path ? voucherFile(uid, z.pdf_path) : null;
  const pdf = file ? await readVoucherPdf(file).catch(withoutMissingFile('gutschein:pdf lesen', null)) : null;
  // Without an original (or with a lost one) the voucher is still downloadable, in LEGO's layout.
  return pdf ?? fillTemplate({ number: z.number, pin: z.pin, amount: Number(z.amount), currency: z.currency });
}

/** A missing file does not abort the export, otherwise it would take every other voucher with it. */
export async function exportVouchers(k: VoucherContext, uid: number) {
  const rows = await voucherList(k, uid, 'aelteste');
  if (!rows.length) failDomain('not_found', 'no_vouchers');
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
  | ({ kind: 'gesperrt' } & Locked)
  | { kind: 'guthaben'; row: VoucherRow; displayed: string | null; currencyChanged: boolean };

/** It checks the PIN and the country BEFORE the throttle: a call that cannot
 * succeed should not use up the one slot per 30 seconds for everyone. The
 * country applies to the whole installation, because a card is only valid in
 * the shop of its issuing country. */
export async function checkBalance(k: VoucherContext, uid: number, id: number): Promise<BalanceResult> {
  const old = await existing(k, uid, id);
  if (!old.pin) failDomain('invalid', 'balance_pin_missing');
  const country = String(
    (await k.settings.globalValue('voucher_country', '')) ||
      countryForCurrency(await k.settings.userValue(uid, 'currency', 'EUR')),
  );
  if (!countryAllowed(country)) failDomain('invalid', 'balance_country_invalid');
  const result = await checkBalanceThrottled(k, uid, old.number, old.pin, { locale: country });
  if (result.kind === 'gesperrt') return result;
  const g = result.balance;
  // The other side's currency wins; a useless value would otherwise ruin the list's total.
  const currency = /^[A-Z]{3}$/.test(g.currency) ? g.currency : old.currency;
  const row = (await repo(k).rememberBalance(uid, id, g.amount, currency)) ?? failDomain('not_found', 'not_found');
  return { kind: 'guthaben', row, displayed: g.formatted, currencyChanged: currency !== old.currency };
}
