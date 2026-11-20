/** Dateien eines gelöschten Kontos, die beim Löschen liegen blieben: Der Auftrag versucht es wieder. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../jobQueue';
import { deleteAccountFiles } from './removeAccount';

const AccountFiles = z.object({ user_id: z.number().int().positive() });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    konto_dateien: typeof AccountFiles;
  }
}

export function accountJobTypes(): Anmeldung[] {
  return [
    auftragsart({ art: 'konto_dateien', nutzlast: AccountFiles, ausfuehren: n => deleteAccountFiles(n.user_id) }),
  ];
}
