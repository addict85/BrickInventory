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
 * Ergebnis eines Serveraufrufs — genau zwei Fälle, damit jedes `when` erschöpfend
 * ist und eine neue Variante an jeder Stelle bricht, die sie behandeln muss. Bitte
 * keinen `else`-Zweig nachrüsten: Er verschluckte künftige Fälle still.
 */
sealed class Result<out T> {
    /**
     * [stand] ist gesetzt, wenn die Daten aus dem Plattenspeicher kommen
     * (Millisekunden seit 1970, Zeitpunkt der Ablage) — sonst sähe ein alter Stand aus
     * wie ein frischer.
     */
    data class Success<T>(val data: T, val stand: Long? = null) : Result<T>() {
        val veraltet: Boolean get() = stand != null
    }
    // unauthorized = true bei HTTP 401: Der Token ist ungültig/abgelaufen. Von
    // "transient" bewusst getrennt — ein 401 ist kein Netzwerkproblem, das ein
    // Retry beheben könnte, und cached() (unten) darf ihn nicht mit einer alten
    // Antwort aus dem Plattenspeicher überdecken.
    data class Error(
        val message: String,
        val transient: Boolean = false,
        val unauthorized: Boolean = false,
        /**
         * Was schiefging — als Aufzählung, nicht als Satz: Die Datenschicht hat keinen
         * Context und kann nicht übersetzen; wie es heisst, entscheidet die Anzeige
         * (AppTexte.meldung()). `null` heisst: Der Text kommt vom Server und wird
         * durchgereicht, er kennt seine Fälle genauer.
         */
        val art: Fehlerart? = null,
        /** HTTP-Code, falls es einen gab — für die Meldung bei [Fehlerart.SERVER]. */
        val httpCode: Int? = null,
        /**
         * Der Fehlercode des Servers (`code` im Rumpf, utils/fehlerTexte.ts).
         * Nach ihm wird verzweigt, nicht nach [message] oder [httpCode]: Der
         * Satz wechselt mit der Sprache, der Status ist für viele Fälle derselbe.
         */
        val code: String? = null,
        /**
         * Technischer Text der Ursache, nur fürs Log: Bibliothekstexte wie „unexpected end
         * of stream“ sind englisch, wechseln mit der Version und gehören nicht in eine
         * Oberfläche.
         */
        val technisch: String? = null
    ) : Result<Nothing>()
}

/**
 * Fehlerursachen, die die Datenschicht selbst erkennt — bewusst grob, weil jede
 * einen eigenen Satz in der Anzeige braucht. Genaueres schreibt der Server in den
 * Fehlerrumpf.
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
 * Seitengrösse der Galerie, wie in der Webapp (public/js/02-gallery.js): Zwei
 * Grössen ergäben zwei Scroll-Erlebnisse für denselben Bestand.
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

/**
 * Vorgabe-Sortierung der Merkliste, identisch mit MERK_SORTS.added_desc
 * (utils/merkliste.ts). Eine eigene Konstante, weil es zwei Tabellen am Server
 * sind, die auseinanderlaufen können.
 */
const val MERKLISTE_DEFAULT_SORT = "added_desc"

/** Status eines PDF-Export-Jobs inkl. geschätzter Restdauer (aus fehlenden Bildern). */
data class PdfJobStatus(val status: String, val etaSeconds: Int?)

/**
 * Die Anlaufstelle zur Datenschicht, nur noch ein Haltepunkt: Die Funktionen
 * liegen in fünf Klassen nach Sachgebieten, und der Zugriff nennt das Gebiet mit
 * (`repo.sets.getSets(...)`, `repo.teile.getParts(...)`,
 * `repo.finanzen.getPnl(...)`). Keine Weiterreich-Fassade, weil die Klasse sonst
 * ihre 78 Mitglieder behielte.
 */
@Singleton
class BrickRepository @Inject constructor(
    val sets: SetsRepository,
    val teile: TeileRepository,
    val finanzen: FinanzenRepository,
    val haushalt: HaushaltRepository,
    val admin: AdminRepository,
    val gutscheine: GutscheineRepository,
    private val cache: ResponseCache,
) {

    /** Beim Abmelden aufrufen: Der Cache enthält Daten des angemeldeten Kontos. */
    suspend fun clearCache() = cache.clear()
}
