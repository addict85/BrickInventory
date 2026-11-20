/** Set master data (rb_sets), its supplement (set_catalog) and the fetch store
 * are written by the catalog; other areas only call in here, with their own
 * access or their transaction. */
export { rememberSetCatalog, rememberCatalogPlaceholder, catalogStatus } from './repository/setMaster';
