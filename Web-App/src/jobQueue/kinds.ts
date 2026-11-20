/** The queue knows no kind: every area registers its own in the wiring,
 * with payload, executor and schedule (startup/wiring.ts). */
import type { z } from 'zod';
import type { JobKind, JobContext, JobRow, Nutzlast, PayloadSchema } from './jobs';

export type Zeitplan =
  | { taeglich: { setting: string; vorgabe: string } }
  | { minuten: { setting?: string; vorgabe: number; mindestens?: number } };

export interface Bearbeiter<A extends JobKind = JobKind> {
  ausfuehren(nutzlast: Nutzlast<A>, k: JobContext, a: JobRow): Promise<void>;
  aufgegeben?(nutzlast: Nutzlast<A>, fehler: string, a: JobRow): Promise<void>;
  exklusiv?: boolean;
}

export interface Anmeldung<A extends JobKind = JobKind> extends Bearbeiter<A> {
  art: A;
  nutzlast: PayloadSchema<A>;
  /** Without an account in the system frame, bypassing row security; the reason is here. */
  kontouebergreifend?: string;
  zeitplan?: Zeitplan;
  /** If it carries an account's data (file content, parts lists), nothing of it stays after success. */
  discardPayload?: boolean;
}

export function auftragsart<A extends JobKind>(a: Anmeldung<A>): Anmeldung {
  return a as unknown as Anmeldung;
}

/** Throws already when queuing, not hours later in the worker. */
export class PayloadInvalid extends Error {}

export class Arten {
  private readonly je = new Map<string, Anmeldung>();

  melde(a: Anmeldung): void {
    if (this.je.has(a.art)) throw new Error(`Auftragsart ${a.art} ist schon angemeldet`);
    this.je.set(a.art, a);
  }

  von(art: string): Anmeldung | undefined {
    return this.je.get(art);
  }

  alle(): Anmeldung[] {
    return [...this.je.values()];
  }

  pruefe<A extends JobKind>(art: A, roh: unknown): Nutzlast<A> {
    const schema: z.ZodType | undefined = this.je.get(art)?.nutzlast;
    if (!schema) throw new PayloadInvalid(`unbekannte Auftragsart ${art}`);
    const r = schema.safeParse(roh);
    if (r.success) return r.data as Nutzlast<A>;
    const i = r.error.issues[0];
    throw new PayloadInvalid(`Nutzlast für ${art} ungültig: ${i?.path.join('.') || '$'}: ${i?.message ?? ''}`);
  }
}
