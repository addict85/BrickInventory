/** In ONE place, so that two locks never carry the same number. */

/** The second parameter of `pg_advisory_lock(a, b)` subdivides further; whoever
 * needs none passes 0. */
export const LOCKS = {
  /** Second value: hashtext(set number). */
  IMAGE_DOWNLOAD: 42,
  /** Second value: hashtext(art). Appears as a number in the trigger from migration 0099. */
  AUFTRAG_EXKLUSIV: 59,
  /** Household currency and linking check the same rule; second value 0. */
  HOUSEHOLD_CURRENCY: 62,
  /** Second value: hashtext(process identifier); held by every job process as long as it lives. */
  JOB_PROCESS: 63,
  /** Runs for minutes, hence a session lock and not a transaction lock. */
  PRICE_JOB: 55,
  ANLEITUNGS_QUEUE: 56,
  IMAGES_FOLLOW_UP: 57,
  /** Second value: number of the target table. */
  CSV_IMPORT: 58,
  /** Second value: user_id. */
  PARTS_SUMMARY: 77,
  PARTS_CATALOG: 79,
  /** Everything that revokes, deactivates or deletes admins; second value 0. */
  ADMIN_INVENTORY: 81,
  /** Second value: hashtext('<user_id>|<key>'). */
  INVENTORY: 61,
  /** Second value: hashtext(set number); "already in scope?" and creation in one step. */
  SET_ADD: 64,
  PROXY_THUMBS: 918273645,
  SCHEMA_INIT: 55667788,
} as const;
