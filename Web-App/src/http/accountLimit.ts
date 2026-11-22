/** How many uploads and event streams an account keeps open at the same time: one should not occupy memory
 * and process for everyone. Per process on purpose: what it protects is this process's memory, so
 * a second web process has its own slots. */
import { processWide } from '../infra/processWide';

export const CONCURRENT = { upload: 2, voucherPdf: 1, stream: 6 } as const;
export type Gate = keyof typeof CONCURRENT;

/** Per process, not per access: the slot is this process's memory (src/infra/processWide.ts). */
const places = () => processWide('kontoSchranke', () => new Map<string, number>());

/** @returns the release (callable several times), or null if the account is already at the limit. */
export function receiptsAccountSpace(kind: Gate, konto: number): (() => void) | null {
  const key = `${kind}:${konto}`;
  const open = places();
  const n = open.get(key) ?? 0;
  if (n >= CONCURRENT[kind]) return null;
  open.set(key, n + 1);
  let free = false;
  return () => {
    if (free) return;
    free = true;
    const rest = (open.get(key) ?? 1) - 1;
    if (rest > 0) open.set(key, rest);
    else open.delete(key);
  };
}
