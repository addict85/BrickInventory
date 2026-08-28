package ch.brickinventoryapp.data.cache

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plattenspeicher für API-Antworten.
 *
 * ── Warum nicht Room ────────────────────────────────────────────────────────
 * Die ursprüngliche Empfehlung lautete „Room-Persistenz". Beim Umsetzen zeigte
 * sich, dass Room hier den falschen Zuschnitt hat:
 *
 *   • Die App fragt ganze Listen ab und ersetzt sie ganz. Es gibt keine
 *     Teilaktualisierungen, keine Joins und keine Abfragen über den Cache —
 *     also nichts, wofür eine relationale Schicht gebaut wird.
 *   • Room verlangt Entities, DAOs, TypeConverter für verschachtelte Listen
 *     (SetItem.instructions), eine Datenbankklasse, ein Hilt-Modul und eine
 *     zweite KSP-Verarbeitung. Jede dieser Stellen ist ein Fehler, der erst
 *     beim Kompilieren auffällt.
 *   • Alle Modelle sind bereits @Serializable, kotlinx.serialization ist
 *     eingebunden. Der Cache braucht damit KEINE neue Abhängigkeit und KEINE
 *     Änderung am Build.
 *
 * Der Nutzen für den Anwender ist derselbe: Die App ist nach dem Start sofort
 * gefüllt und bleibt offline benutzbar, statt bei jedem Öffnen alles neu zu
 * laden und ohne Netz leer zu bleiben.
 *
 * ── Verhalten ───────────────────────────────────────────────────────────────
 * Geschrieben wird bei jeder erfolgreichen Antwort. Gelesen wird nur, wenn der
 * Netzabruf fehlschlägt — der Server bleibt die Wahrheit, der Cache ist die
 * Rückfallebene. Damit kann der Cache nie eine frische Antwort verdrängen.
 *
 * Einträge tragen eine Formatversion. Ändert sich ein Modell, wird VERSION
 * erhöht und alles Alte verworfen, statt an einer veralteten Struktur zu
 * scheitern.
 */
@Singleton
class ResponseCache internal constructor(
    /**
     * Woher der Ablageordner kommt. Als Funktion statt als fertiger [File],
     * damit die Auswertung faul bleibt — `context.cacheDir` beim Bauen des
     * Objekts abzufragen, würde den Zugriff in die Hilt-Graph-Erzeugung ziehen.
     *
     * Der eigentliche Grund für diesen Umweg (Nachtrag 117): So lässt sich der
     * Cache im Test mit einem Wegwerf-Verzeichnis bauen, ohne Android-Laufzeit.
     * Vorher hing die Klasse an einem [Context], und damit hing alles, was sie
     * braucht — auch [ch.brickinventoryapp.data.repository.BrickRepository],
     * dessen Fehlerabbildung dadurch nicht prüfbar war.
     */
    private val ordnerQuelle: () -> File
) {
    // Ohne @param:-Ziel: Der Parameter ist hier kein Property (kein `val`), die
    // Zweideutigkeit aus Kotlin 2.2+ stellt sich also gar nicht. Die anderen
    // Klassen im Projekt schreiben @param:, weil sie den Context als Property
    // halten.
    @Inject constructor(@ApplicationContext context: Context) :
        this({ context.cacheDir })

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()

    private val dir: File by lazy {
        File(ordnerQuelle(), "api-$VERSION").apply { mkdirs() }
    }

    /** Dateiname aus dem Schlüssel — nur unbedenkliche Zeichen. */
    private fun fileFor(key: String) = File(dir, key.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")

    /**
     * Antwort ablegen. Fehler werden geschluckt: Ein nicht schreibbarer Cache
     * darf einen erfolgreichen Abruf nicht zum Fehler machen.
     */
    suspend fun <T> put(key: String, serializer: KSerializer<T>, value: T) = withContext(Dispatchers.IO) {
        try {
            mutex.withLock {
                val tmp = File(dir, fileFor(key).name + ".tmp")
                tmp.writeText(json.encodeToString(serializer, value))
                tmp.renameTo(fileFor(key))      // atomar, nie halbe Dateien lesen
            }
        } catch (_: Throwable) { /* Best effort */ }
    }

    /**
     * Antwort lesen. Gibt null zurück, wenn nichts da ist, der Eintrag älter
     * als maxAgeMs ist oder sich nicht mehr lesen lässt (Modell geändert).
     */
    suspend fun <T> get(key: String, serializer: KSerializer<T>, maxAgeMs: Long = MAX_AGE_MS): T? =
        withContext(Dispatchers.IO) {
            try {
                val f = fileFor(key)
                if (!f.exists()) return@withContext null
                if (System.currentTimeMillis() - f.lastModified() > maxAgeMs) return@withContext null
                json.decodeFromString(serializer, f.readText())
            } catch (_: Throwable) {
                null
            }
        }

    /** Beim Abmelden aufrufen — der Cache enthält Daten des angemeldeten Kontos. */
    suspend fun clear() = withContext(Dispatchers.IO) {
        try { mutex.withLock { dir.listFiles()?.forEach { it.delete() } } } catch (_: Throwable) {}
    }

    companion object {
        /**
         * Bei jeder Änderung an den gecachten Modellen erhöhen. Der
         * Verzeichnisname enthält die Version, alte Stände werden dadurch
         * schlicht nicht mehr gefunden.
         */
        private const val VERSION = 1

        /** Sieben Tage. Der Cache ist Rückfallebene, kein Ersatz für den Abruf. */
        private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    }
}
