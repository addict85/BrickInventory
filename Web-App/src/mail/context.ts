/** What the sender gets: only the settings (SMTP, sender address, theme).
 * Separate from area.ts so a module knows its type without an import cycle. */
import type { AppConfig } from '../infra/config';
import type { SettingsServices } from '../settings';
import type { Clock } from '../infra/clock';

export interface MailDependencies {
  uhr: Clock;
  konfig: Readonly<AppConfig>;
  einstellungen: SettingsServices;
}

export type MailContext = MailDependencies;
