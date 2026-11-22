/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as setupStatus from './setupStatus';
import * as indexHtml from './indexHtml';
import { access, type ProfileDependencies, type ProfileContext } from './context';

export type { ProfileDependencies, ProfileContext } from './context';

/** Profile, themed start page and setup status: what an account sees and changes about itself. */
export function createProfile(a: Omit<ProfileDependencies, 'faecher'>, inspect?: Inspect<ProfileContext>) {
  return buildArea(
    { ...a, faecher: new Compartments() },
    access,
    (k: ProfileContext) => ({
      setupStatus: bound(k)(setupStatus.setupStatus),
      startPageHtml: bound(k)(indexHtml.startPageHtml),
      setGlobalTheme: bound(k)(indexHtml.setGlobalTheme),
    }),
    inspect,
  );
}

export type ProfileServices = ReturnType<typeof createProfile>;
