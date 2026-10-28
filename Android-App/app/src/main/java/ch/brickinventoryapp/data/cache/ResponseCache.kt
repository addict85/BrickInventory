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
 *
 * Jede Ablage gehört einem Bereich aus Server und Sitzung ([CacheBesitzer]).
 * Nach einem Kontowechsel oder auf einem anderen Server findet ein Abruf nur
 * Einträge seines eigenen Bereichs — nie die eines anderen Kontos.
 */
@Singleton
class ResponseCache internal constructor(
    /**
     * Server und Sitzung, denen die Einträge gehören; null heisst „nicht
     * angemeldet“, dann wird nichts abgelegt. Die Vorgabe mit einem festen
     * Bereich ist für Tests, die nur ein Konto kennen.
     */
    private val bereichQuelle: suspend () -> String? = { "test" },
    /** Ein früherer Ablageort, der beim ersten Zugriff geräumt wird. */
    private val altlast: () -> File? = { null },
    /**
     * Woher der Ablageordner kommt. Eine Funktion, damit `context` erst beim
     * ersten Zugriff gefragt wird und der Test ein Wegwerf-Verzeichnis geben kann.
     */
    private val ordnerQuelle: () -> File,
) {
    /**
     * `noBackupFilesDir` statt `cacheDir`: Den Cache darf das System jederzeit
     * leeren — offline wäre die App dann leer. Ohne Sicherung, weil die
     * Antworten zum Konto gehören und das Gerät nicht verlassen sollen.
     */
    @Inject constructor(@ApplicationContext context: Context, besitzer: CacheBesitzer) : this(
        bereichQuelle = { besitzer.cacheBereich() },
        altlast = { File(context.cacheDir, "api-1") },
        ordnerQuelle = { context.noBackupFilesDir },
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()

    private val basis: File by lazy {
        runCatching { altlast()?.deleteRecursively() }
        File(ordnerQuelle(), "api-$VERSION").apply { mkdirs() }
    }

    /** Der Bereich, der gerade gilt; null, wenn nichts abgelegt werden darf. */
    suspend fun bereich(): String? = runCatching { bereichQuelle() }.getOrNull()?.takeIf { it.isNotBlank() }

    private fun fach(bereich: String) = File(basis, bereichsName(bereich))

    /** Dateiname aus dem Schlüssel — nur unbedenkliche Zeichen. */
    private fun fileFor(bereich: String, key: String) =
        File(fach(bereich), key.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")

    /**
     * Antwort ablegen und die Fächer anderer Bereiche räumen: Auf dem Gerät
     * ist immer nur eine Sitzung angemeldet, Daten früherer Konten haben hier
     * nichts mehr zu suchen. Fehler werden geschluckt — ein nicht schreibbarer
     * Cache darf einen erfolgreichen Abruf nicht zum Fehler machen.
     */
    suspend fun <T> put(bereich: String, key: String, serializer: KSerializer<T>, value: T) = withContext(Dispatchers.IO) {
        try {
            mutex.withLock {
                val fach = fach(bereich).apply { mkdirs() }
                basis.listFiles()?.filter { it.isDirectory && it.name != fach.name }?.forEach { it.deleteRecursively() }
                val ziel = fileFor(bereich, key)
                val tmp = File(fach, ziel.name + ".tmp")
                tmp.writeText(json.encodeToString(serializer, value))
                tmp.renameTo(ziel)      // atomar, nie halbe Dateien lesen
            }
        } catch (_: Throwable) { /* Best effort */ }
    }

    /**
     * Antwort samt Zeitpunkt der Ablage — damit die Anzeige „Stand von …“
     * sagen kann. Null, wenn nichts da ist, der Eintrag älter als [maxAgeMs]
     * ist oder sich nicht mehr lesen lässt (Modell geändert).
     */
    suspend fun <T> getMitStand(bereich: String, key: String, serializer: KSerializer<T>,
                                maxAgeMs: Long = MAX_AGE_MS): Pair<T, Long>? =
        withContext(Dispatchers.IO) {
            try {
                val f = fileFor(bereich, key)
                if (!f.exists()) return@withContext null
                val stand = f.lastModified()
                if (System.currentTimeMillis() - stand > maxAgeMs) return@withContext null
                json.decodeFromString(serializer, f.readText()) to stand
            } catch (_: Throwable) {
                null
            }
        }

    /** Beim Abmelden aufrufen — alle Bereiche, nicht nur der aktuelle. */
    suspend fun clear() = withContext(Dispatchers.IO) {
        try { mutex.withLock { basis.listFiles()?.forEach { it.deleteRecursively() } } } catch (_: Throwable) {}
    }

    companion object {
        /**
         * Bei jeder Änderung an den gecachten Modellen oder am Aufbau der
         * Ablage erhöhen; alte Stände werden dadurch schlicht nicht gefunden.
         */
        private const val VERSION = 2

        /** Sieben Tage. Der Cache ist Rückfallebene, kein Ersatz für den Abruf. */
        private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

        /** Ordnername des Bereichs: gestreut, damit weder Adresse noch Token auf der Platte stehen. */
        internal fun bereichsName(bereich: String): String =
            java.security.MessageDigest.getInstance("SHA-256").digest(bereich.toByteArray())
                .joinToString("") { "%02x".format(it) }.take(32)
    }
}

/**
 * Wem die abgelegten Antworten gehören: Server und Sitzung. Im Gerät der
 * PreferencesManager; die Schnittstelle hält den Cache ohne DataStore prüfbar.
 */
fun interface CacheBesitzer {
    /** Null, solange kein Server oder kein Token hinterlegt ist. */
    suspend fun cacheBereich(): String?
}
