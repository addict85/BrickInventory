/** Files of a deleted account that were left behind on deletion: the job tries again. */
import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { deleteAccountFiles } from './removeAccount';

const AccountFiles = z.object({ user_id: z.number().int().positive() });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    account_files: typeof AccountFiles;
  }
}

export function accountJobTypes(): Login[] {
  return [jobKind({ kind: 'account_files', payload: AccountFiles, ausfuehren: n => deleteAccountFiles(n.user_id) })];
}
