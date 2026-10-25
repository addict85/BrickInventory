/**
 * Dateien entgegennehmen — die Grenzen stehen an EINER Stelle.
 * Ausführlich: docs/begruendungen/utils/dateiEmpfang.ts.md#abschnitt
 */
import multer from 'multer';

/**
 * Wie gross eine hochgeladene CSV-Datei sein darf.
 *
 * 15 MB ist der gewachsene Wert aus den drei Fassungen; er ist gross genug für
 * einen vollständigen Bestandsexport aus BrickLink und klein genug, dass eine
 * versehentlich gewählte Datei den Speicher nicht sprengt — `memoryStorage`
 * hält sie vollständig im Arbeitsspeicher.
 */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Die Annahme für Textdateien, die sofort zerlegt werden: die CSV-Importe
 * (Sets, Teile, Minifiguren, Merkliste, Preisalarme) und die
 * BrickLink-Wanted-Liste als XML.
 * Ausführlich: docs/begruendungen/utils/dateiEmpfang.ts.md#csvempfang
 */
export const csvEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES },
});
