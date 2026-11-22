/** The public side of the area: everyone else imports only from here, the shape below stays free to change. */
export type { Correction as Korrektur } from './wantedResolution';
export { createWanted } from './area';
export type { WantedServices, WantedContext } from './area';
