/** The public face of the area: others import only from here, the cut below stays free. */
export type { ResetSideEffects, AccountNotice } from './mailer';
export { createMail } from './area';
export type { MailDependencies, MailServices, MailContext } from './area';
