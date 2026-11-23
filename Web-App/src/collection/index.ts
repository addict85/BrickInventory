/** The public side of the area: everyone else imports only from here, the shape below stays free to change. */
export type { AcquisitionKind } from './acquisitions';
export { createCollection } from './area';
export type { CollectionServices, CollectionContext } from './area';
export { WantedCorrections } from './importJobs';
export type { ImportInput, ImportSource } from './importJobs';
