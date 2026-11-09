package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.model.data.model.AddSetResponse
import ch.brickinventoryapp.data.di.BrickDispatchers
import ch.brickinventoryapp.data.di.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Ein Set anlegen — mit Fortschritt, wie die Webapp über /api/v1/sets/add-stream
 * (Stammdaten holen, Bild laden, fertig), damit man bei einem grossen Set sieht,
 * was passiert.
 * Ausführlich: docs/begruendungen/core-data/data/SetAnlegenSseClient.kt.md#constructor
 */
@Singleton
internal class SetAnlegenSseClient @Inject constructor(
    @SseClient private val client: OkHttpClient,
    private val prefs: Zugangsdaten,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : SetAnleger {
    private val json = Json { ignoreUnknownKeys = true }

    // Die Schritte stehen als SetAnlegenSchritt in SetAnleger.kt.

    /**
     * Anlegen und dabei zuhoeren.
     *
     * Kalter Fluss: Die Anfrage geht erst beim Sammeln los. Ein Abbruch des
     * Sammelns schliesst die Verbindung — ANLEGEN tut das nicht rueckgaengig,
     * der Server schreibt weiter. Genau deshalb bietet die Oberflaeche hier
     * auch keinen Abbrechen-Knopf an (siehe GalleryFeature.addSet).
     */
    override fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: String?, ownerUserId: Int?, storage: String?,
    ): Flow<SetAnlegenSchritt> = callbackFlow {
        val baseUrl = prefs.serverUrlJetzt().trim().trimEnd('/')
        val token = prefs.tokenJetzt()
        if (baseUrl.isBlank() || token.isBlank()) {
            trySend(SetAnlegenSchritt.Fehler("")); close(); return@callbackFlow
        }

        val rumpf = anlegeRumpf(setNumber, quantity, purchasePrice, condition, ownerUserId, storage)
        val anfrage = Request.Builder()
            .url("$baseUrl/api/v1/sets/add-stream")
            .header("Accept", "text/event-stream")
            .post(rumpf)
            .build()

        val aufruf = client.newCall(anfrage)
        fun scheitert(e: Exception) {
            trySend(SetAnlegenSchritt.Fehler(e.message ?: ""))
            close()
        }
        try {
            aufruf.execute().use { antwort -> leseAntwort(antwort) { trySend(it) } }
            close()
        } catch (_: java.net.UnknownHostException) {
            trySend(SetAnlegenSchritt.KeineVerbindung); close()
        } catch (_: java.net.ConnectException) {
            // Nur diese beiden: Die Anfrage kam nie an, ein zweiter Versuch über den
            // Ausgang kann nichts doppelt anlegen. Ein Abbruch mitten im Strom schon.
            trySend(SetAnlegenSchritt.KeineVerbindung); close()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: java.io.IOException) {
            scheitert(e)
        } catch (e: IllegalArgumentException) {
            // Auch eine unlesbare Antwort (SerializationException).
            scheitert(e)
        } catch (e: IllegalStateException) {
            scheitert(e)
        }
        awaitClose { aufruf.cancel() }
    }.flowOn(io)

    /**
     * Von Hand gebaut statt ueber eine Datenklasse: Die Felder, die NICHT
     * gesetzt sind, sollen auch nicht im Rumpf stehen — der Server
     * unterscheidet „kein Kaufpreis" von „Kaufpreis null" (utils/validate).
     */
    private fun anlegeRumpf(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: String?, ownerUserId: Int?, storage: String?,
    ): RequestBody {
        val felder = buildList {
            add("\"set_number\":${json.encodeToString(kotlinx.serialization.serializer(), setNumber)}")
            add("\"quantity\":$quantity")
            if (purchasePrice != null) add("\"purchase_price\":$purchasePrice")
            if (condition != null) add("\"condition\":\"$condition\"")
            if (ownerUserId != null) add("\"owner_user_id\":$ownerUserId")
            // Der Lagerort ist freier Text und muss deshalb ueber den
            // Serialisierer, nicht in die Zeichenkette gesetzt: Ein
            // Anfuehrungszeichen im Namen („Regal \"A\"") zerbraeche den Rumpf
            // sonst. Dieselbe Vorsicht wie eine Zeile hoeher bei set_number.
            if (!storage.isNullOrBlank())
                add("\"storage\":${json.encodeToString(kotlinx.serialization.serializer(), storage)}")
        }
        return "{${felder.joinToString(",")}}"
            .toRequestBody("application/json; charset=utf-8".toMediaType())
    }

    /** Die Antwort lesen: Absage, die JSON-Form oder der Ereignisstrom. */
    private fun leseAntwort(antwort: Response, sende: (SetAnlegenSchritt) -> Unit) {
        // `antwort.body` ist seit OkHttp 5 nicht nullbar.
        val koerper = antwort.body
        if (!antwort.isSuccessful) {
            sende(SetAnlegenSchritt.Fehler(fehlertextAus(koerper.string())))
            return
        }
        // Die JSON-Form: Das Set stand schon im Blickfeld.
        if (antwort.header("Content-Type")?.contains("application/json") == true) {
            val text = koerper.string()
            sende(SetAnlegenSchritt.Fertig(json.decodeFromString(AddSetResponse.serializer(), text)))
            return
        }
        // Die Stromform: `data: {…}` je Zeile, Leerzeilen trennen.
        koerper.source().use { quelle ->
            while (!quelle.exhausted()) {
                val zeile = quelle.readUtf8LineStrict()
                if (!zeile.startsWith("data:")) continue
                val nutzlast = zeile.removePrefix("data:").trim()
                if (nutzlast.isEmpty()) continue
                if (verarbeite(nutzlast, sende)) break
            }
        }
    }

    /**
     * Ein Ereignis auswerten.
     *
     * @return true, wenn der Vorgang damit beendet ist (fertig oder Fehler).
     */
    private fun verarbeite(nutzlast: String, sende: (SetAnlegenSchritt) -> Unit): Boolean {
        // Ein unlesbares Ereignis ist ein Fehler, kein Rauschen: Es könnte das „done“ sein,
        // und ohne Abschluss sähe der Nutzer nie, ob das Set angelegt wurde.
        val obj = try {
            json.parseToJsonElement(nutzlast).jsonObject
        } catch (_: IllegalArgumentException) {
            sende(SetAnlegenSchritt.Fehler(""))
            return true
        }
        // Dieselben Schrittnamen wie in der Webapp (public/js/02-gallery.js →
        // handleSseEvent). Sie stehen hier ein zweites Mal, weil es ein
        // Protokoll zwischen zwei Programmen ist — aber in derselben
        // Reihenfolge und mit derselben Bedeutung.
        return when (obj["step"]?.jsonPrimitive?.content) {
            "meta"      -> { sende(SetAnlegenSchritt.Stammdaten(obj["set"]?.jsonPrimitive?.content)); false }
            "image"     -> { sende(SetAnlegenSchritt.Bild); false }
            "done_meta" -> { sende(SetAnlegenSchritt.FastFertig); false }
            "done"      -> {
                sende(SetAnlegenSchritt.Fertig(json.decodeFromString(AddSetResponse.serializer(), nutzlast)))
                true
            }
            "error"     -> {
                sende(SetAnlegenSchritt.Fehler(obj["error"]?.jsonPrimitive?.content.orEmpty()))
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
