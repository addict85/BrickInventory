package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.model.AddSetResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Ein Set anlegen — mit Fortschritt, wie in der Webapp.
 *
 * ── Warum es diesen Weg gibt (Nachtrag 131) ─────────────────────────────────
 *
 * Die Webapp legt ein Set ueber /api/v1/sets/add-stream an und zeigt dabei, was
 * gerade passiert: Stammdaten holen, Bild laden, fertig. Die App schickte ein
 * gewoehnliches POST /api/v1/sets und zeigte einen Kringel, bis alles vorbei
 * war. Gleiches Ergebnis, andere Rueckmeldung — und bei einem grossen Set
 * dauert der Unterschied lange genug, um aufzufallen.
 *
 * ── Warum NICHT okhttp-sse ──────────────────────────────────────────────────
 *
 * Diese Adresse antwortet in ZWEI Formen, und das ist Absicht (routes/sets.ts):
 *
 *   * Steht das Set schon im Blickfeld, schreibt der Server NICHTS und
 *     antwortet mit gewoehnlichem JSON — ein Ereignisstrom mit genau einem
 *     Ereignis waere fuer den Client nur ein Umweg.
 *   * Sonst kommt ein `text/event-stream` mit den Schritten.
 *
 * `EventSources` von okhttp-sse meldet die erste Form als FEHLER, weil der
 * Inhaltstyp nicht passt — der haeufige Fall „hab ich schon" saehe damit aus
 * wie ein Verbindungsabbruch. Deshalb wird die Antwort hier selbst gelesen:
 * eine Zeile ist eine Zeile, und der Inhaltstyp entscheidet, wie sie gemeint
 * ist.
 */
@Singleton
class SetAnlegenSseClient @Inject constructor(
    @Named("sse") private val client: OkHttpClient,
    private val prefs: PreferencesManager,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Was der Server unterwegs meldet. */
    sealed class Schritt {
        /** Stammdaten geholt — der Name steht ab hier fest. */
        data class Stammdaten(val name: String?) : Schritt()
        /** Bild wird geladen. */
        object Bild : Schritt()
        /** Stammdaten und Bild sind durch; es fehlt nur noch das Aufraeumen. */
        object FastFertig : Schritt()
        /** Fertig — dieselbe Antwort, die auch das gewoehnliche POST liefert. */
        data class Fertig(val ergebnis: AddSetResponse) : Schritt()
        /** Der Server meldet einen Fehler; der Text ist schon uebersetzt. */
        data class Fehler(val meldung: String) : Schritt()
    }

    /**
     * Anlegen und dabei zuhoeren.
     *
     * Kalter Fluss: Die Anfrage geht erst beim Sammeln los. Ein Abbruch des
     * Sammelns schliesst die Verbindung — ANLEGEN tut das nicht rueckgaengig,
     * der Server schreibt weiter. Genau deshalb bietet die Oberflaeche hier
     * auch keinen Abbrechen-Knopf an (siehe GalleryFeature.addSet).
     */
    fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: String?, ownerUserId: Int?,
    ): Flow<Schritt> = callbackFlow {
        val baseUrl = prefs.serverUrl.first().trim().trimEnd('/')
        val token = prefs.authToken.first()
        if (baseUrl.isBlank() || token.isBlank()) {
            trySend(Schritt.Fehler("")); close(); return@callbackFlow
        }

        // Von Hand gebaut statt ueber eine Datenklasse: Die Felder, die NICHT
        // gesetzt sind, sollen auch nicht im Rumpf stehen — der Server
        // unterscheidet „kein Kaufpreis" von „Kaufpreis null" (utils/validate).
        val felder = buildList {
            add("\"set_number\":${json.encodeToString(kotlinx.serialization.serializer(), setNumber)}")
            add("\"quantity\":$quantity")
            if (purchasePrice != null) add("\"purchase_price\":$purchasePrice")
            if (condition != null) add("\"condition\":\"$condition\"")
            if (ownerUserId != null) add("\"owner_user_id\":$ownerUserId")
        }
        val rumpf = "{${felder.joinToString(",")}}"
            .toRequestBody("application/json; charset=utf-8".toMediaType())

        val anfrage = Request.Builder()
            .url("$baseUrl/api/v1/sets/add-stream")
            .header("Accept", "text/event-stream")
            .post(rumpf)
            .build()

        val aufruf = client.newCall(anfrage)
        try {
            aufruf.execute().use { antwort ->
                val koerper = antwort.body
                if (!antwort.isSuccessful || koerper == null) {
                    trySend(Schritt.Fehler(fehlertextAus(koerper?.string())))
                    close(); return@use
                }
                // Die JSON-Form: Das Set stand schon im Blickfeld.
                if (antwort.header("Content-Type")?.contains("application/json") == true) {
                    val text = koerper.string()
                    trySend(Schritt.Fertig(json.decodeFromString(AddSetResponse.serializer(), text)))
                    close(); return@use
                }
                // Die Stromform: `data: {…}` je Zeile, Leerzeilen trennen.
                koerper.source().use { quelle ->
                    while (!quelle.exhausted()) {
                        val zeile = quelle.readUtf8LineStrict()
                        if (!zeile.startsWith("data:")) continue
                        val nutzlast = zeile.removePrefix("data:").trim()
                        if (nutzlast.isEmpty()) continue
                        val fertig = verarbeite(nutzlast) { trySend(it) }
                        if (fertig) break
                    }
                }
                close()
            }
        } catch (e: Exception) {
            trySend(Schritt.Fehler(e.message ?: ""))
            close()
        }
        awaitClose { aufruf.cancel() }
    }.flowOn(Dispatchers.IO)

    /**
     * Ein Ereignis auswerten.
     *
     * @return true, wenn der Vorgang damit beendet ist (fertig oder Fehler).
     */
    private fun verarbeite(nutzlast: String, sende: (Schritt) -> Unit): Boolean {
        val obj = try { json.parseToJsonElement(nutzlast).jsonObject } catch (_: Exception) { return false }
        // Dieselben Schrittnamen wie in der Webapp (public/js/02-gallery.js →
        // handleSseEvent). Sie stehen hier ein zweites Mal, weil es ein
        // Protokoll zwischen zwei Programmen ist — aber in derselben
        // Reihenfolge und mit derselben Bedeutung.
        return when (obj["step"]?.jsonPrimitive?.content) {
            "meta"      -> { sende(Schritt.Stammdaten(obj["set"]?.jsonPrimitive?.content)); false }
            "image"     -> { sende(Schritt.Bild); false }
            "done_meta" -> { sende(Schritt.FastFertig); false }
            "done"      -> {
                sende(Schritt.Fertig(json.decodeFromString(AddSetResponse.serializer(), nutzlast)))
                true
            }
            "error"     -> {
                sende(Schritt.Fehler(obj["error"]?.jsonPrimitive?.content.orEmpty()))
                true
            }
            else -> false
        }
    }

    /** Aus einer Fehlerantwort den Satz holen, den der Server geschickt hat. */
    private fun fehlertextAus(koerper: String?): String =
        try {
            json.parseToJsonElement(koerper.orEmpty()).jsonObject["error"]?.jsonPrimitive?.content.orEmpty()
        } catch (_: Exception) { "" }
}
