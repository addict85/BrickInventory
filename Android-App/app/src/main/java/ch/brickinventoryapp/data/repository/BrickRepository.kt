package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Ergebnis eines Serveraufrufs — bewusst nur ZWEI Fälle.
 *
 * Es gab lange eine dritte Variante `Loading`, die nirgends erzeugt wurde:
 * [safeCall] liefert ausschliesslich [Success] oder [Error]. Ihr einziger
 * Effekt war, dass jedes `when` einen `else`-Zweig brauchte — und ein
 * `else -> {}` verschluckt stillschweigend auch jeden Fall, der später
 * dazukommt. Mit genau zwei Varianten ist jedes `when` erschöpfend, und
 * eine neue Variante bricht den Build an jeder Stelle, die sie behandeln
 * muss. Bitte keinen `else`-Zweig nachrüsten.
 */
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    // unauthorized = true bei HTTP 401: Der Token ist ungültig/abgelaufen. Von
    // "transient" bewusst getrennt — ein 401 ist kein Netzwerkproblem, das ein
    // Retry beheben könnte, und cached() (unten) darf ihn nicht mit einer alten
    // Antwort aus dem Plattenspeicher überdecken.
    data class Error(
        val message: String,
        val transient: Boolean = false,
        val unauthorized: Boolean = false,
        /**
         * Was schiefging — als AUFZÄHLUNG, nicht als Satz (Nachtrag 116).
         *
         * Bis dahin erzeugte diese Schicht ihre Meldungen selbst: „Netzwerkfehler",
         * „Zeitüberschreitung", „Leere Antwort vom Server". Deutsche Sätze, mitten
         * im Repository — und das Repository hat keinen Context, kann also gar
         * nicht übersetzen. Für einen englischsprachigen Nutzer war damit JEDE
         * Fehlermeldung deutsch, egal wie sauber der Bildschirm darüber
         * lokalisiert war. Dieselbe Ursache wie beim PDF-Betrachter in Nachtrag
         * 115, nur an der Stelle, die alle Fehler formuliert.
         *
         * Jetzt entscheidet diese Schicht nur noch, WAS passiert ist; WIE es
         * heisst, entscheidet die Anzeige (siehe MainViewModel.meldung()).
         *
         * `null` heisst: Der Text kommt vom Server und wird durchgereicht — der
         * kennt seine Fälle genauer als jede Aufzählung hier (Kaufdatum-Konflikt,
         * Währung passt nicht, Code schon eingelöst).
         */
        val art: Fehlerart? = null,
        /** HTTP-Code, falls es einen gab — für die Meldung bei [Fehlerart.SERVER]. */
        val httpCode: Int? = null,
        /**
         * Technischer Text der Ursache, NUR fürs Log. Bewusst getrennt von
         * [message]: Bibliothekstexte wie „unexpected end of stream" sind
         * englisch, wechseln mit der Bibliotheksversion und gehören nicht in
         * eine Oberfläche.
         */
        val technisch: String? = null
    ) : Result<Nothing>()
}

/**
 * Fehlerursachen, die die Datenschicht selbst erkennt.
 *
 * Bewusst grob: Jede Unterscheidung hier muss die Anzeige in einen eigenen
 * Satz übersetzen können. Was der Server im Fehlerrumpf schreibt, ist genauer
 * und wird durchgereicht statt hier einsortiert.
 */
enum class Fehlerart {
    /** Host nicht auflösbar, Verbindung abgelehnt — vorübergehend. */
    NETZ,
    /** Zeitüberschreitung — vorübergehend. */
    ZEIT,
    /** HTTP 2xx, aber kein Rumpf. */
    LEERE_ANTWORT,
    /** HTTP-Fehlercode ohne verwertbaren Fehlerrumpf. */
    SERVER,
    /** Kein Server oder kein Token hinterlegt. */
    NICHT_ANGEMELDET,
    /** Die Gegenseite hat den Datenstrom geschlossen (SSE). */
    VERBINDUNG_BEENDET,
    /** Sitzung abgelaufen (HTTP 401). */
    SITZUNG_ABGELAUFEN,
    /** Sonstiges, ohne nähere Einordnung. */
    UNBEKANNT,
}

/**
 * Seitengrösse der Galerie. Derselbe Wert wie in der Webapp
 * (public/js/02-gallery.js) — der Server deckelt page_size ohnehin, aber zwei
 * verschiedene Seitengrössen ergäben zwei verschiedene Scroll-Erlebnisse für
 * denselben Bestand.
 */
const val GALLERY_PAGE_SIZE = 60

/**
 * Seitengrösse des Katalogs. Muss zur Rechnung des Servers passen: Der
 * Jahres-Sprung liefert `page` für genau diese Grösse, und aus `offset` leitet
 * die Ansicht die Seite selbst ab.
 */
const val CATALOG_PAGE_SIZE = 60

/** Vorgabe-Sortierung; identisch mit SET_SORTS.added_desc auf dem Server. */
const val GALLERY_DEFAULT_SORT = "added_desc"

/** Status eines PDF-Export-Jobs inkl. geschätzter Restdauer (aus fehlenden Bildern). */
data class PdfJobStatus(val status: String, val etaSeconds: Int?)

/**
 * Die Anlaufstelle zur Datenschicht — jetzt nur noch ein Haltepunkt.
 *
 * ── Was sich geaendert hat (Nachtrag 155) ───────────────────────────────────
 *
 * Diese Klasse hatte 78 oeffentliche Funktionen. Sie liegen jetzt in fuenf
 * Klassen nach Sachgebieten, und der Zugriff nennt das Gebiet mit:
 *
 *     repo.sets.getSets(...)          repo.teile.getParts(...)
 *     repo.finanzen.getPnl(...)       repo.haushalt.getHousehold(...)
 *     repo.admin.getJobs(...)
 *
 * Das aendert 89 Aufrufstellen in 16 Dateien — bewusst, denn die beiden Wege,
 * die ohne diese Aenderung ausgekommen waeren, sind geprueft und ausgeschieden:
 *
 *   Schnittstellen mit Delegation   Kotlin erlaubt Vorgabewerte nicht in einer
 *                                   Ueberschreibung; 18 der 78 Funktionen haben
 *                                   welche, alle 78 Signaturen stuenden doppelt da
 *   Erweiterungsfunktionen          brauchen einen Import an jeder Aufrufstelle,
 *                                   und 17 Namen kollidieren mit den vorhandenen
 *                                   MainViewModel-Erweiterungen
 *
 * Eine Weiterreich-Fassade mit 78 Einzeilern waere moeglich gewesen und haette
 * die Aufrufstellen geschont — sie haette den Befund aber nicht behoben: Die
 * Klasse haette weiterhin 78 Mitglieder.
 */
@Singleton
class BrickRepository @Inject constructor(
    val sets: SetsRepository,
    val teile: TeileRepository,
    val finanzen: FinanzenRepository,
    val haushalt: HaushaltRepository,
    val admin: AdminRepository,
    private val cache: ResponseCache,
) {

    /** Beim Abmelden aufrufen: Der Cache enthält Daten des angemeldeten Kontos. */
    suspend fun clearCache() = cache.clear()
}
