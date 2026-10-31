/**
 * Welche Katalogbilder fehlen oder lokal liegen, und Lücken im Set-Katalog —
 * die Schnittstelle der Nachläufe und der PDF-Erzeugung zum Katalog.
 */
export {
  setsMitFehlendenKatalogbildern, manuelleTeileOhneBild, figurenOhneBild, setBilderOhneDatei, merkeSetBildLokal,
  lokaleKatalogbilder, teilbilder, figurenbilder, fuelleSetLuecken, setsOhneAnleitung,
} from './repository/bildlage';
