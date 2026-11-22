/** Profile of the own account: name, username and address. A new address only applies
 * after the link; the mails go through the mail area. */
import crypto from 'node:crypto';
import { mailBasisUrl } from '../infra/baseUrl';
import { failDomain } from '../infra/errorTexts';
import { attempts, valueOr } from '../infra/result';
import { inSystemContext } from '../infra/accountContext';
import { tokenDigest } from './deviceToken';
import { accountThrottled } from './targetThrottle';
import type { Account as AccountRow } from './repository/accounts';
import type { AccountContext } from './context';

type Account = AccountRow;
export interface ProfileInput {
  username?: string | undefined;
  email?: string | null | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
}

export function emailWillChange(user: Account, email: string | null | undefined): email is string {
  return !!email && email.toLowerCase() !== String(user.email || '').toLowerCase();
}

/** After a confirmed password. A new address only applies after the link; until
 * then the old one applies, and the new one occupies nothing. */
export async function changeProfile(
  k: AccountContext,
  user: Account,
  e: ProfileInput,
): Promise<{ emailChanged: boolean; emailSent?: boolean }> {
  const nameNew = !!e.username && e.username.toLowerCase() !== String(user.username || '').toLowerCase();
  const newEmail = emailWillChange(user, e.email);
  if (nameNew || newEmail) {
    // Every availability check reveals whether an account exists; registration hides that.
    const zuOft = await accountThrottled(k, 'profil-vergabe', user.id, 10, 60 * 60 * 1000);
    if (zuOft) failDomain('zu_viele', 'too_many_requests', { minutes: zuOft.waitMin });
    if (nameNew && e.username && (await k.konten.nameTaken(e.username, user.id)))
      failDomain('ungueltig', 'username_taken');
  }
  const fields: Record<string, unknown> = {};
  if (e.first_name !== undefined) fields.first_name = e.first_name || null;
  if (e.last_name !== undefined) fields.last_name = e.last_name || null;
  const save = async () => {
    if (e.username) await k.konten.changeUsernames(user.id, e.username);
    await k.konten.changeNames(user.id, fields);
  };
  if (!newEmail) {
    await save();
    return { emailChanged: false };
  }
  const email = String(e.email);
  const token = crypto.randomBytes(32).toString('hex');
  await k.konten.rememberEmailNew(user.id, email, tokenDigest(token), new Date(k.clock.now() + 24 * 60 * 60 * 1000));
  await save();
  return { emailChanged: true, emailSent: await addressMails(k, user, email, token) };
}

/** Language of the account, not the default. Taken answers like free, otherwise
 * addresses could be probed; the owner gets a notice instead of the link. */
async function addressMails(k: AccountContext, user: Account, email: string, token: string): Promise<boolean> {
  // Also that of the owner of an address, another account: in the system frame.
  const language = async (uid: number) =>
    String(
      valueOr(
        await attempts(
          'anmeldung:sprache',
          inSystemContext('adressmail', () => k.settings.userValue(uid, 'language', 'de')),
        ),
        'de',
      ),
    );
  const lang = await language(user.id);
  const basis = mailBasisUrl();
  let sent = false;
  const holder = await k.konten.accountWithEmail(email);
  if (holder && holder.id !== user.id) {
    if (basis)
      sent = valueOr(
        await attempts(
          'anmeldung:versuchsmail',
          k.mail.mailRegistrationAttempt(holder.email, await language(holder.id), 'adresse'),
        ),
        { success: false },
      ).success;
  } else if (basis) {
    sent = valueOr(
      await attempts('anmeldung:bestaetigungsmail', k.mail.mailVerification(email, token, basis, lang, 'adresse')),
      { success: false },
    ).success;
  }
  // The old address learns about it — if it was not the owner, they notice that way.
  if (user.email)
    await attempts('anmeldung:hinweis-alte-adresse', k.mail.mailEmailChanged(user.email, user.username, email, lang));
  return sent;
}
