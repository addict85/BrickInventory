package ch.brickinventoryapp.data.cache

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.data.di.BrickDispatchers
import ch.brickinventoryapp.data.di.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.sicherheit.Ablageschluessel
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plattenspeicher für API-Antworten, damit die App nach dem Start gefüllt ist und
 * offline benutzbar bleibt.
 * Gelesen wird nur, wenn der Netzabruf scheitert — der Server bleibt die Wahrheit.
 */
@Singleton
class ResponseCache(
    /**
     * Server und Sitzung, denen die Einträge gehören; null heisst „nicht
     * angemeldet“, dann wird nichts abgelegt. Die Vorgabe mit einem festen
     * Bereich ist für Tests, die nur ein Konto kennen.
     */
    private val bereichQuelle: suspend () -> String? = { "test" },
    /** Ein früherer Ablageort, der beim ersten Zugriff geräumt wird. */
    private val altlast: () -> File? = { null },
    /**
     * Verschlüsselt jede Datei: Inventar und Preise liegen sonst bei Root
     * oder einem ausgelesenen Datenverzeichnis offen. Null nur in Tests ohne Keystore.
     */
    private val chiffre: AblageChiffre? = null,
    /** Für Platte und Verschlüsselung. */
    private val io: CoroutineDispatcher,
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
    @Inject constructor(
        @ApplicationContext context: Context,
        besitzer: CacheBesitzer,
        ablage: Ablageschluessel,
        @Dispatcher(BrickDispatchers.IO) io: CoroutineDispatcher,
    ) : this(
        bereichQuelle = { besitzer.cacheBereich() },
        altlast = { File(context.cacheDir, "api-1") },
        chiffre = AblageChiffre { ablage.fuer("antworten") },
        io = io,
        ordnerQuelle = { context.noBackupFilesDir },
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()

    private val basis: File by lazy {
        runCatching { altlast()?.deleteRecursively() }
        val neu = File(ordnerQuelle(), "api-$VERSION").apply { mkdirs() }
        // Die Vorfassung (verschlüsselt, ohne Bindung) wird übernommen, nicht verworfen:
        // Offline wäre die App sonst nach dem Update leer.
        runCatching { uebernimm(File(ordnerQuelle(), "api-${VERSION - 1}"), neu) }
        // Frühere Fassungen der Ablage (bis 2 im Klartext) gleich mit räumen, nicht nur übergehen.
        runCatching {
            ordnerQuelle().listFiles()?.filter { it.isDirectory && it.name.startsWith("api-") && it.name != "api-$VERSION" }
                ?.forEach { it.deleteRecursively() }
        }
        neu
    }

    /** Zweck, Fach und Dateiname als AAD: Eine umbenannte oder verschobene Datei gilt nicht. */
    private fun bindung(datei: File) = "antworten/${datei.parentFile?.name}/${datei.name}"

    /** Liest jede Datei der Vorfassung ohne Bindung und legt sie gebunden unter [neu] ab, mit ihrem Stand. */
    private fun uebernimm(alt: File, neu: File) {
        for (fach in alt.listFiles()?.filter { it.isDirectory }.orEmpty()) {
            for (datei in fach.listFiles()?.filter { it.isFile && it.name.endsWith(".json") }.orEmpty()) {
                val roh = datei.readBytes()
                val klar = if (chiffre == null) roh else chiffre.entschluessleUngebunden(roh) ?: continue
                val ziel = File(File(neu, fach.name).apply { mkdirs() }, datei.name)
                if (ziel.exists()) continue
                ziel.writeBytes(chiffre?.verschluessle(klar, bindung(ziel)) ?: klar)
                ziel.setLastModified(datei.lastModified())
            }
        }
    }

    /** Der Bereich, der gerade gilt; null, wenn nichts abgelegt werden darf. */
    suspend fun bereich(): String? = fangeAusserAbbruch { bereichQuelle() }.getOrNull()?.takeIf { it.isNotBlank() }

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
    suspend fun <T> put(bereich: String, key: String, serializer: KSerializer<T>, value: T) {
        withContext(io) {
            fangeAusserAbbruch {
                mutex.withLock {
                    val fach = fach(bereich).apply { mkdirs() }
                    basis.listFiles()?.filter { it.isDirectory && it.name != fach.name }?.forEach { it.deleteRecursively() }
                    val ziel = fileFor(bereich, key)
                    val tmp = File(fach, ziel.name + ".tmp")
                    val text = json.encodeToString(serializer, value).toByteArray(Charsets.UTF_8)
                    tmp.writeBytes(chiffre?.verschluessle(text, bindung(ziel)) ?: text)
                    tmp.renameTo(ziel)      // atomar, nie halbe Dateien lesen
                }
            }
        }
    }

    /**
     * Antwort samt Zeitpunkt der Ablage — damit die Anzeige „Stand von …“
     * sagen kann. Null, wenn nichts da ist, der Eintrag älter als [maxAgeMs]
     * ist oder sich nicht mehr lesen lässt (Modell geändert).
     */
    suspend fun <T> getMitStand(bereich: String, key: String, serializer: KSerializer<T>,
                                maxAgeMs: Long = MAX_AGE_MS): Pair<T, Long>? =
        withContext(io) {
            fangeAusserAbbruch {
                val f = fileFor(bereich, key)
                if (!f.exists()) return@withContext null
                val stand = f.lastModified()
                if (System.currentTimeMillis() - stand > maxAgeMs) return@withContext null
                val roh = f.readBytes()
                val text = if (chiffre == null) roh else chiffre.entschluessle(roh, bindung(f)) ?: return@withContext null
                json.decodeFromString(serializer, text.toString(Charsets.UTF_8)) to stand
            }.getOrNull()
        }

    /** Beim Abmelden aufrufen — alle Bereiche, nicht nur der aktuelle. */
    suspend fun clear() {
        withContext(io) { fangeAusserAbbruch { mutex.withLock { basis.listFiles()?.forEach { it.deleteRecursively() } } } }
    }

    companion object {
        /**
         * Bei jeder Änderung an den gecachten Modellen oder am Aufbau der
         * Ablage erhöhen; alte Stände werden dadurch schlicht nicht gefunden.
         * Einzige Ausnahme ist 3 → 4 ([uebernimm]): Nur die Bindung kam dazu.
         */
        private const val VERSION = 4

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
 * TokenAblage; die Schnittstelle hält den Cache ohne DataStore prüfbar.
 */
fun interface CacheBesitzer {
    /** Null, solange kein Server oder kein Token hinterlegt ist. */
    suspend fun cacheBereich(): String?

    /**
     * Server und Konto, ohne den Token: Der wechselt beim Tausch (Rotation), und
     * Room-Ablage samt Ausgang müssen das überleben. Null wie [cacheBereich].
     */
    suspend fun kontoBereich(): String? = cacheBereich()
}
