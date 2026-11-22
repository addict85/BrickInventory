/** The owner learns by mail when something about their accesses changes:
 * an intruder who sets a password or passkey would otherwise go unnoticed. */
import type { ResetSideEffects, AccountNotice } from '../mail';
import { logAndContinue, reportAndDeliver } from '../infra/error';
import { inSystemContext } from '../infra/accountContext';
import type { AccountContext } from './context';

type Details = {
  name?: string | undefined;
  account?: string | undefined;
  actor?: string | undefined;
  was?: string | undefined;
  bis?: string | undefined;
  resolved?: ResetSideEffects | undefined;
  cancelToken?: string | undefined;
  releaseToken?: string | undefined;
  address?: string | undefined;
};

// Also runs before login and for other accounts (all administrators): it therefore reads
// the recipient's language and household in the system frame.
export function reportAccountChange(
  k: AccountContext,
  uid: number,
  kind: AccountNotice,
  details: Details = {},
): Promise<boolean> {
  return inSystemContext('kontohinweis', () => reportAccountChangeFor(k, uid, kind, details));
}

async function reportAccountChangeFor(
  kx: AccountContext,
  uid: number,
  kind: AccountNotice,
  details: Details,
): Promise<boolean> {
  if (!(await kx.mail.mailConfigured())) return false;
  const k = await kx.accounts.profileRow(uid);
  if (!k?.email) return false;
  const lang = String(await kx.settings.userValue(uid, 'language', 'de'));
  const household = (await kx.household.householdStatus(uid)).parents.map(p => p.username);
  const r = await kx.mail.mailAccountNotice(k.email, k.username, kind, {
    lang,
    household,
    ...(details.name ? { passkey: details.name } : {}),
    account: details.account,
    actor: details.actor,
    was: details.was,
    bis: details.bis,
    resolved: details.resolved,
    cancelToken: details.cancelToken,
    releaseToken: details.releaseToken,
    address: details.address,
  });
  return r.success;
}

/** In the background: the response does not wait for the mail server, and an error does not undo the change. */
export function hintInBackground(
  k: AccountContext,
  uid: number,
  kind: AccountNotice,
  name?: string,
  details: Details = {},
): void {
  // A trace in the log even without a mail address; without name and label, which are typed freely.
  console.info(`[konto] ${kind}`, { event: kind, account: uid });
  reportAccountChange(k, uid, kind, { ...details, name }).catch(logAndContinue(`konto:hinweismail ${kind}`));
}

/** To all administrators: nobody should appoint an administrator or dismantle protection unnoticed. */
export function adminHintInBackground(k: AccountContext, kind: AccountNotice, details: Details): void {
  k.accounts
    .activeAdmin()
    .then(ids => Promise.all(ids.map(id => reportAccountChange(k, id, kind, details))))
    .catch(logAndContinue(`konto:verwalterhinweis ${kind}`));
}

/** After joining, the owner learns by mail whom they joined; in the background,
 * so the response does not wait for the mail server. */
export async function joinHousehold(k: AccountContext, uid: number, code: string) {
  const r = await k.household.redeemInvitation(uid, code);
  const ich = await k.accounts.profileRow(uid);
  if (ich?.email) {
    const language = await k.settings
      .userValue(uid, 'language', 'de')
      .catch(reportAndDeliver('einstellungen:sprache', 'de'));
    void k.mail
      .mailHouseholdLinked(ich.email, ich.username, r.linked_to.username, String(language ?? 'de'))
      .catch(logAndContinue('haushalt:hinweismail'));
  }
  return r;
}
