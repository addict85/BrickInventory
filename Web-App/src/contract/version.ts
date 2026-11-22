/** Every response carries both as a header so that the app can say who
 * has to update. Increment only on a change that breaks the counterpart. */
export const API_VERSION = 2;
export const API_MIN_APP = 2;
/** The day /api/v1 ends (Sunset header, docs/openapi-v2.json, UPGRADE.md). */
export const SUNSET_DAY = '2027-06-30';
