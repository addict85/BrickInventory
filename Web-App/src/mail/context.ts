/** What the sender gets: only the settings (SMTP, sender address, theme).
 * Separate from area.ts so a module knows its type without an import cycle. */
import type { Konfig } from '../infra/konfig';
import type { SettingsServices } from '../settings';
import type { Uhr } from '../infra/uhr';

export interface MailDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  einstellungen: SettingsServices;
}

export type MailContext = MailDependencies;
