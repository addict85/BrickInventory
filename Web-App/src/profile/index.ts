/** The public side of the area: everyone else imports only from here, the shape below stays free to change. */
export { createProfile } from './area';
export type { ProfileServices, ProfileContext } from './area';
export { forgetTheme, startPageStyleHash } from './indexHtml';
