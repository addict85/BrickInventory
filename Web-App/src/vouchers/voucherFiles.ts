import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import {
  verschluesselePuffer,
  entschluesselePuffer,
  istVerschluesselterPuffer,
  altenPufferLesen,
  kontext,
  pufferUmschluesseln,
} from '../infra/geheimnis';
import { ohneFehlendeDatei } from '../infra/fehler';

/** The PDFs carry the card number and PIN in plain text; encrypted, a copy of
 * data/ without the key does not give them away. */
export const VOUCHER_DIR = path.join(DATA_DIR, 'vouchers');

/** Even a path from our own database must belong to the account; `base + sep`,
 * otherwise vouchers/12 would count as being under vouchers/1. */
export function voucherFile(userId: number, pdfPath: string): string | null {
  const base = path.resolve(VOUCHER_DIR, String(userId));
  const target = path.resolve(VOUCHER_DIR, pdfPath);
  return target.startsWith(base + path.sep) ? target : null;
}

/** The location under vouchers/ (account/voucher.pdf) as context: a file copied
 * into another voucher or another account stays unreadable.
 * NOTE: the literal tag ('gutschein-pdf') is part of the encryption AAD for
 * files already on disk — it must not change, even though the code around it does. */
function fileContext(file: string) {
  return kontext('gutschein-pdf', path.relative(VOUCHER_DIR, file).split(path.sep).join('/'));
}

/** Only the finished file gets its name. */
export async function writeVoucherPdf(file: string, pdf: Buffer): Promise<void> {
  await replaceFile(file, verschluesselePuffer(pdf, fileContext(file)));
}

async function replaceFile(file: string, content: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const part = `${file}.${process.pid}.part`;
  await fs.promises.writeFile(part, content, { mode: 0o600 });
  await fs.promises.rename(part, file);
}

/** null if the key or location do not match, or the file is unencrypted. */
export async function readVoucherPdf(file: string): Promise<Buffer | null> {
  return entschluesselePuffer(await fs.promises.readFile(file), fileContext(file));
}

/** If the file is missing, the page is regenerated without aborting the export. */
export async function readVoucherPdfOrNothing(file: string | null): Promise<Buffer | null> {
  if (!file) return null;
  return readVoucherPdf(file).catch(ohneFehlendeDatei('gutschein:pdf lesen', null));
}

/** Unencrypted and BIENC1 files to BIENC2, on every start; BIENC2 stays, unless
 * `all` (key rotation): then anything only the previous key opens is renewed. */
export async function encryptLegacyVoucherFiles(o: { alle?: boolean } = {}): Promise<number> {
  if (!fs.existsSync(VOUCHER_DIR)) return 0;
  let n = 0;
  for (const account of fs.readdirSync(VOUCHER_DIR).filter(k => /^\d+$/.test(k))) {
    const dir = path.join(VOUCHER_DIR, account);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter(f => /^\d+\.pdf$/.test(f))) {
      const file = path.join(dir, name);
      const raw = await fs.promises.readFile(file);
      if (istVerschluesselterPuffer(raw)) {
        const neu = o.alle ? pufferUmschluesseln(raw, fileContext(file)) : undefined;
        if (neu) {
          await replaceFile(file, neu);
          n++;
        }
        continue;
      }
      const plain = altenPufferLesen(raw, fileContext(file));
      if (!plain) continue;
      await writeVoucherPdf(file, plain);
      n++;
    }
  }
  return n;
}
