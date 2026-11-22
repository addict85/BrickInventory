import { rekey } from '../infra/secret';
import { secondFactorContext } from './secondFactor';
import type { FactorsContext } from './context';

/** Bring plaintext and v1 (without context) up to v2 before a request reads them:
 * entschluessele() only accepts v2 now. Runs on every start; v2 stays as it is. */
export async function encryptLegacySecrets(k: FactorsContext, o: { all?: boolean } = {}): Promise<number> {
  let n = await k.settings.reencryptLegacyGlobalValues();
  for (const z of await k.legacySecrets.legacyFactorSecrets(o.all)) {
    const fresh = rekey(z.v, secondFactorContext(z.uid));
    if (fresh) n += await k.legacySecrets.replaceFactorSecret(z.uid, z.v, fresh);
  }
  return n;
}
