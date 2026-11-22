/** The area's public side: others import only from here, the cut below stays free to change. */
export {
  DESIGNS,
  SECRET_KEYS,
  isValidGlobalValue,
  isMasked,
  isValidUserValue,
} from './settings';
export { createSettings } from './area';
export type { SettingsServices, SettingsContext } from './area';
