// Names of the job kinds and statuses in the UI language.

import { tRaw } from '../i18n.js';

/**
 * Names of the job kinds and statuses — spelled out, so that every key stands checkably in the dictionary.
 * @type {Record<string, () => string>}
 */
export const KIND_NAMES = {
  rework: () => tRaw('monitor.kind.rework'),
  images: () => tRaw('monitor.kind.images'),
  pdf: () => tRaw('monitor.kind.pdf'),
  csv_import: () => tRaw('monitor.kind.csv_import'),
  exchange_rates: () => tRaw('monitor.kind.wechselkurse'),
  instructions: () => tRaw('monitor.kind.instructions'),
  brickset: () => tRaw('monitor.kind.brickset'),
  image_demand: () => tRaw('monitor.kind.bildbedarf'),
  images_reload: () => tRaw('monitor.kind.images_new_load'),
  followup: () => tRaw('monitor.kind.follow_up'),
  csv_sync: () => tRaw('monitor.kind.csv_sync'),
  prices: () => tRaw('monitor.kind.prices'),
  price_refresh: () => tRaw('monitor.kind.prices_reload'),
  image_followup: () => tRaw('monitor.kind.image_follow_up'),
  cleanup: () => tRaw('monitor.kind.cleanup'),
  cleanup_daily: () => tRaw('monitor.kind.cleanup_daily'),
  account_files: () => tRaw('monitor.kind.account_files'),
  revocation_list: () => tRaw('monitor.kind.revocation_list'),
  catalog_followup: () => tRaw('monitor.kind.catalog_catch_up'),
  voucher_balances: () => tRaw('monitor.kind.voucher_balances'),
};
/** @type {Record<string, () => string>} */
const STATUS_NAMES = {
  pending: () => tRaw('monitor.jobs.open'),
  running: () => tRaw('monitor.jobs.running'),
  error: () => tRaw('monitor.jobs.error'),
  cancelled: () => tRaw('monitor.jobs.cancelled'),
};
/** The name of a job kind in the UI language, already escaped; unknown ones stay as they are. */
export const kindName = (/** @type {string} */ kind) => (Object.hasOwn(KIND_NAMES, kind) ? KIND_NAMES[kind]() : kind);
/** The name of a job status in the UI language; unknown ones stay as they are. */
export const statusName = (/** @type {string} */ s) => (Object.hasOwn(STATUS_NAMES, s) ? STATUS_NAMES[s]() : s);
