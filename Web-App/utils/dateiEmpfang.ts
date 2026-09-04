/**
 * Dateien entgegennehmen — die Grenzen stehen an EINER Stelle.
 *
 * ── Warum es diese Datei gibt (Nachtrag 128) ────────────────────────────────
 *
 * Die CSV-Annahme stand DREIMAL zeichengleich da:
 *
 *     routes/sets.ts:64       const upload    = multer({ … 15 * 1024 * 1024 })
 *     routes/parts.ts:502     const csvUpload = multer({ … 15 * 1024 * 1024 })
 *     routes/minifigs.ts:486  const csvUpload = multer({ … 15 * 1024 * 1024 })
 *
 * Drei Namen, eine Sache — und drei Orte, an denen die Grenze steht. Wer sie
 * einmal anhebt, hebt sie an einem Drittel der Wege an, und welcher Import
 * dann eine grössere Datei annimmt, hängt davon ab, welche Datei man
 * aufgemacht hat. Genau diese Form hat in dieser Reihe schon ein Dutzend Mal
 * zu auseinanderlaufendem Verhalten geführt.
 *
 * Die ZAHL ist hier nicht nur eine Zahl: Sie muss zu dem passen, was die
 * Oberflächen dem Nutzer sagen, bevor er eine Datei wählt. Die Android-App
 * liest sie nicht aus dem Netz, sie steht dort ebenfalls — deshalb trägt die
 * Konstante ihren Wert im Namen der Fehlermeldung mit.
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
 * Die Annahme für CSV-Importe: Sets, Teile und Minifiguren.
 *
 * `memoryStorage`, weil alle drei Importe die Datei ohnehin sofort in Zeilen
 * zerlegen und nie auf die Platte legen. Das Feld heisst überall `file` —
 * dieselbe Schreibweise wie in der Webapp und in der App.
 */
export const csvEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES },
});
