package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
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

@Singleton
class BrickRepository @Inject constructor(
    internal val api: BrickApiService,
    internal val cache: ch.brickinventoryapp.data.cache.ResponseCache
) {

    /**
     * Netzabruf mit Plattenspeicher als Rückfallebene.
     *
     * Reihenfolge ist bewusst „erst Netz, dann Cache": Der Server bleibt die
     * Wahrheit, der Cache springt nur ein, wenn der Abruf scheitert. Ein
     * Cache-First-Ansatz würde frische Daten verdrängen.
     *
     * Nutzen: Nach einem Neustart ohne Netz — oder bei langsamer Verbindung —
     * ist die App gefüllt statt leer. Bisher lud sie bei jedem Öffnen alles neu
     * und blieb offline vollständig unbrauchbar.
     */
    internal suspend fun <T : Any> cached(
        key: String,
        serializer: kotlinx.serialization.KSerializer<T>,
        call: suspend () -> Result<T>,
    ): Result<T> {
        val fresh = call()
        if (fresh is Result.Success) {
            cache.put(key, serializer, fresh.data)
            return fresh
        }
        // Eine abgelaufene Sitzung darf nicht durch bis zu 7 Tage alte
        // Plattendaten verdeckt werden — sonst sieht der Nutzer eine scheinbar
        // normale Galerie, obwohl er längst ausgeloggt ist (siehe logout() in
        // SessionFeature.kt, das per SessionExpiredSignal ausgelöst wird).
        if (fresh is Result.Error && fresh.unauthorized) return fresh
        val stored = cache.get(key, serializer)
        return if (stored != null) Result.Success(stored) else fresh
    }

    // ── Wo der Rest steht (Nachtrag 155) ────────────────────────────────────
    //
    // Diese Klasse hatte 78 oeffentliche Funktionen in 519 Zeilen — eine
    // Anlaufstelle fuer Sets, Teile, Minifiguren, Finanzen, Haushalt, Katalog
    // und Betrieb zugleich. Die Funktionen stehen jetzt als
    // ERWEITERUNGSFUNKTIONEN in Dateien nach Sachgebieten daneben:
    //
    //     BrickRepositorySets.kt       BrickRepositoryTeile.kt
    //     BrickRepositoryFinanzen.kt   BrickRepositoryHaushalt.kt
    //     BrickRepositoryAdmin.kt
    //
    // Fuer Aufrufer aendert sich NICHTS: repo.getSets(...) loest genauso auf
    // wie zuvor.
    //
    // ── Warum Erweiterungen und nicht Schnittstellen mit Delegation ─────────
    //
    // Die sauberere Zerlegung waere `class BrickRepository : SetsRepo by ...`.
    // Sie scheitert hier an den Vorgabewerten: 18 der 78 Funktionen haben
    // welche, und Kotlin erlaubt Vorgabewerte NICHT in einer Ueberschreibung.
    // Sie muessten alle in die Schnittstelle wandern, und jede der 78
    // Signaturen stuende ein zweites Mal da — ueber 160 Zeilen Doppelung, die
    // bei jeder Aenderung an zwei Stellen nachzuziehen waere.
    //
    // Der Preis dieser Wahl: api, cache, cached() und safeCall() sind nicht
    // mehr `private`, sondern `internal` — Erweiterungen kommen an private
    // Mitglieder nicht heran. Sie bleiben damit im Modul eingeschlossen,
    // sind aber innerhalb der App sichtbar. Das ist die bewusst in Kauf
    // genommene Einbusse.

    /** Beim Abmelden aufrufen: Der Cache enthält Daten des angemeldeten Kontos. */
    suspend fun clearCache() = cache.clear()
}
