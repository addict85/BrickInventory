import { rekey } from '../infra/secret';
import { secondFactorContext } from './secondFactor';
import type { FactorsContext } from './context';

/** Bring plaintext and v1 (without context) up to v2 before a request reads them:
 * entschluessele() only accepts v2 now. Runs on every start; v2 stays as it is. */
export async function encryptLegacySecrets(k: FactorsContext, o: { alle?: boolean } = {}): Promise<number> {
  let n = await k.einstellungen.reencryptLegacyGlobalValues();
  for (const z of await k.legacySecrets.legacyFactorSecrets(o.alle)) {
    const fresh = rekey(z.v, secondFactorContext(z.uid));
    if (fresh) n += await k.legacySecrets.replaceFactorSecret(z.uid, z.v, fresh);
  }
  return n;
}
