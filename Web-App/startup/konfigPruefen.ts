/**
 * Als erster Import von server.ts: prüft die ganze Konfiguration, bevor ein
 * anderes Modul beim Laden einen Wert liest. Ein Fehler beendet den Start mit
 * einer Meldung je Variable statt mit einem Stacktrace aus irgendeinem Modul.
 */
import { pruefeKonfigBeimStart, konfig } from '../src/infra/konfig';

pruefeKonfigBeimStart();

export { konfig };
