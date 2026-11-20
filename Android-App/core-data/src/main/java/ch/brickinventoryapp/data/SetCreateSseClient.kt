package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.SetRecorded
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.netz.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.vertrag.AddSetResponse
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.transformWhile
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Ein Set anlegen — mit Fortschritt, wie die Webapp über /api/v1/sets/add-stream
 * (Stammdaten holen, Bild laden, fertig), damit man bei einem grossen Set sieht,
 * was passiert. Über [sseStream] wie CSV-Import und PDF-Auftrag: ein Leser für alle Ströme.
 */
@Singleton
internal class SetCreateSseClient @Inject constructor(
    @SseClient private val client: OkHttpClient,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : SetCreator {

    /**
     * Kalter Fluss: Die Anfrage geht erst beim Sammeln los. Ein Abbruch des Sammelns
     * schliesst die Verbindung, das Anlegen am Server läuft weiter — deshalb gibt es
     * keinen Abbrechen-Knopf. Der letzte Schritt ist immer Fertig, Fehler oder NoConnection.
     */
    override fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String?,
    ): Flow<SetCreateStep> {
        // Adresse und Token setzt der Wächter des Clients, wie bei jedem Abruf.
        val anfrage = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/add-stream")
            .header("Accept", "text/event-stream")
            .post(createBody(setNumber, quantity, purchasePrice, condition, ownerUserId, storage))
            .build()
        return sseStream(client, anfrage) { json.parseToJsonElement(it).jsonObject }.transformWhile { e ->
            val schritt = when (e) {
                is SseEvent.Daten -> schritt(e.wert)
                // Ein unlesbares Ereignis könnte das „done“ sein; ein Ende ohne es lässt offen,
                // ob das Set angelegt wurde. Beides ist ein Abbruch, kein Satz des Servers.
                is SseEvent.Unlesbar, SseEvent.Ended -> SetCreateStep.Fehler("")
                is SseEvent.Gescheitert -> withoutStream(e)
            }
            if (schritt != null) emit(schritt)
            !schritt.isLast()
        }.flowOn(io)
    }

    private fun SetCreateStep?.isLast() =
        this is SetCreateStep.Fertig || this is SetCreateStep.Fehler || this == SetCreateStep.NoConnection

    /**
     * Von Hand gebaut statt über eine Datenklasse: Felder, die nicht gesetzt sind, fehlen
     * im Rumpf — der Server unterscheidet „kein Kaufpreis“ von „Kaufpreis null“. Freier
     * Text geht durch den Serialisierer, sonst zerbräche ein Anführungszeichen den Rumpf.
     */
    private fun createBody(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String?,
    ): RequestBody {
        val felder = buildList {
            add("\"set_number\":${json.encodeToString(kotlinx.serialization.serializer(), setNumber)}")
            add("\"quantity\":$quantity")
            if (purchasePrice != null) add("\"purchase_price\":$purchasePrice")
            if (condition != null) add("\"condition\":\"${condition.kennung}\"")
            if (ownerUserId != null) add("\"owner_user_id\":$ownerUserId")
            if (!storage.isNullOrBlank())
                add("\"storage\":${json.encodeToString(kotlinx.serialization.serializer(), storage)}")
        }
        return "{${felder.joinToString(",")}}"
            .toRequestBody("application/json; charset=utf-8".toMediaType())
    }

    /**
     * Ein Ereignis des Stroms; null für Unbekanntes. Dieselben Schrittnamen wie in der
     * Webapp (public/js/sammlung.js): ein Protokoll zwischen zwei Programmen.
     */
    private fun schritt(obj: JsonObject): SetCreateStep? = when (obj["step"]?.jsonPrimitive?.content) {
        "meta" -> SetCreateStep.Stammdaten(obj["set"]?.jsonPrimitive?.content)
        "image" -> SetCreateStep.Bild
        "done_meta" -> SetCreateStep.FastDone
        "done" -> fertig(obj.toString())
        "error" -> SetCreateStep.Fehler(obj["error"]?.jsonPrimitive?.content.orEmpty())
        else -> null
    }

    /**
     * Ohne Ereignisstrom: Die Anfrage kam nie an, der Server lehnte ab, oder er antwortete
     * in der JSON-Form (das Set stand schon im Blickfeld). Nur „nie angekommen“ darf über
     * den Ausgang wiederholt werden; ein Abbruch mitten im Strom könnte doppelt anlegen.
     */
    private fun withoutStream(e: SseEvent.Gescheitert): SetCreateStep {
        val code = e.code
        return when {
            code == null -> if (e.noConnection) SetCreateStep.NoConnection else SetCreateStep.Fehler("")
            code in HTTP_SUCCESS && e.rumpf != null -> fertig(e.rumpf)
            else -> SetCreateStep.Fehler(errorTextFrom(e.rumpf))
        }
    }

    private fun fertig(text: String): SetCreateStep = try {
        val r = json.decodeFromString(AddSetResponse.serializer(), text)
        if (r.success) SetCreateStep.Fertig(r.asRecorded()) else SetCreateStep.Fehler(errorTextFrom(text))
    } catch (_: IllegalArgumentException) {
        SetCreateStep.Fehler("")
    }

    /** Aus einer Fehlerantwort den Satz holen, den der Server geschickt hat. */
    private fun errorTextFrom(koerper: String?): String =
        try {
            json.parseToJsonElement(koerper.orEmpty()).jsonObject["error"]?.jsonPrimitive?.content.orEmpty()
        } catch (_: IllegalArgumentException) { "" }

    private companion object {
        val HTTP_SUCCESS = 200..299
    }
}

/** Die Antwort auf ein angelegtes Set als Fachwert; „gepuffert“ ist weder angelegt noch vorhanden. */
internal fun AddSetResponse.asRecorded() = SetRecorded(
    nummer = setNumber,
    name = name,
    angelegt = action == "added",
    vorhanden = action == "exists",
    katalogOffen = katalogOffen,
    supplementPending = ergaenzung == "ausstehend",
)
