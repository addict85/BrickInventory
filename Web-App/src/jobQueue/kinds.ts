/** The queue knows no kind: every area registers its own in the wiring,
 * with payload, executor and schedule (startup/wiring.ts). */
import type { z } from 'zod';
import type { JobKind, JobContext, JobRow, Payload, PayloadSchema } from './jobs';

export type Schedule =
  | { taeglich: { setting: string; vorgabe: string } }
  | { minuten: { setting?: string; vorgabe: number; mindestens?: number } };

export interface Handler<A extends JobKind = JobKind> {
  ausfuehren(payload: Payload<A>, k: JobContext, a: JobRow): Promise<void>;
  aufgegeben?(payload: Payload<A>, fehler: string, a: JobRow): Promise<void>;
  exklusiv?: boolean;
}

export interface Login<A extends JobKind = JobKind> extends Handler<A> {
  art: A;
  nutzlast: PayloadSchema<A>;
  /** Without an account in the system frame, bypassing row security; the reason is here. */
  kontouebergreifend?: string;
  zeitplan?: Schedule;
  /** If it carries an account's data (file content, parts lists), nothing of it stays after success. */
  discardPayload?: boolean;
}

export function jobKind<A extends JobKind>(a: Login<A>): Login {
  return a as unknown as Login;
}

/** Throws already when queuing, not hours later in the worker. */
export class PayloadInvalid extends Error {}

export class Kinds {
  private readonly je = new Map<string, Login>();

  report(a: Login): void {
    if (this.je.has(a.art)) throw new Error(`Auftragsart ${a.art} ist schon angemeldet`);
    this.je.set(a.art, a);
  }

  fromValue(art: string): Login | undefined {
    return this.je.get(art);
  }

  all(): Login[] {
    return [...this.je.values()];
  }

  check<A extends JobKind>(art: A, raw: unknown): Payload<A> {
    const schema: z.ZodType | undefined = this.je.get(art)?.nutzlast;
    if (!schema) throw new PayloadInvalid(`unbekannte Auftragsart ${art}`);
    const r = schema.safeParse(raw);
    if (r.success) return r.data as Payload<A>;
    const i = r.error.issues[0];
    throw new PayloadInvalid(`Nutzlast für ${art} ungültig: ${i?.path.join('.') || '$'}: ${i?.message ?? ''}`);
  }
}
