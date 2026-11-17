/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as setupStatus from './setupStatus';
import * as indexHtml from './indexHtml';
import { access, type ProfileDependencies, type ProfileContext } from './context';

export type { ProfileDependencies, ProfileContext } from './context';

/** Profile, themed start page and setup status: what an account sees and changes about itself. */
export function createProfile(a: Omit<ProfileDependencies, 'faecher'>, einblick?: Einblick<ProfileContext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    access,
    (k: ProfileContext) => ({
      setupStatus: mit(k)(setupStatus.setupStatus),
      startPageHtml: mit(k)(indexHtml.startPageHtml),
      setGlobalTheme: mit(k)(indexHtml.setGlobalTheme),
    }),
    einblick,
  );
}

export type ProfileServices = ReturnType<typeof createProfile>;
