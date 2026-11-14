/** Der Einstieg in den Bereich Sets: Routen und andere Bereiche importieren nur
 * von hier, damit die Aufteilung der Dateien darunter frei bleibt. Was Datenbank
 * oder Nacharbeit braucht, entsteht in bereich.ts. */

export { erzeugeSets } from './bereich';
export type { SetsDienste } from './bereich';
export type { SetsKontext } from './kontext';
export { normalizeSetNumber, nacharbeitEinstellen } from './erfassen';
export { sanitizeSetNumber } from './setService';
export { QUELLE_GESTOERT } from './inhalt';
export { setCsvZeilen } from './csvImport';
export { ANLEITUNGS_WURZEL } from './anleitungen';
export type { Erfassung, NeuesSet, SetErfasst, SetHinzufuegen, VorhandenesSet, Fortschritt } from './erfassen';
export type { MoveResult } from './setMove';
export type { BarcodeTreffer } from './barcode';
export type { ImportZeile } from './csvImport';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';
