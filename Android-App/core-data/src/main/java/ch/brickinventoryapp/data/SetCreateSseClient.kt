package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
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
 * Create a set — with progress, like the web app via /api/v1/sets/add-stream
 * (fetch master data, load image, done), so that with a large set one sees
 * what happens. Via [sseStream] like CSV import and PDF job: one reader for all streams.
 */
@Singleton
internal class SetCreateSseClient @Inject constructor(
    @SseClient private val client: OkHttpClient,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : SetCreator {

    /**
     * Cold flow: the request only goes out on collecting. Cancelling the collection
     * closes the connection, the creation on the server keeps running — hence there is
     * no cancel button. The last step is always Fertig, Fehler or NoConnection.
     */
    override fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String?,
    ): Flow<SetCreateStep> {
        // Address and token are set by the client's guard, as for every fetch.
        val anfrage = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/add-stream")
            .header("Accept", "text/event-stream")
            .post(createBody(setNumber, quantity, purchasePrice, condition, ownerUserId, storage))
            .build()
        return sseStream(client, anfrage) { json.parseToJsonElement(it).jsonObject }.transformWhile { e ->
            val schritt = when (e) {
                is SseEvent.Daten -> schritt(e.wert)
                // An unreadable event could be the „done“; an end without it leaves open
                // whether the set was created. Both are an abort, not a sentence of the server.
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
     * Built by hand instead of via a data class: fields that are not set are missing
     * in the body — the server distinguishes „no purchase price“ from „purchase price null“. Free
     * text goes through the serializer, otherwise a quotation mark would break the body.
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
     * An event of the stream; null for unknown ones. The same step names as in the
     * web app (public/js/collection.js): a protocol between two programs.
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
     * Without an event stream: the request never arrived, the server refused, or it answered
     * in the JSON form (the set was already in view). Only „never arrived“ may be
     * retried via the outbox; an abort in the middle of the stream could create twice.
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

    /** Get the sentence the server sent from an error response. */
    private fun errorTextFrom(koerper: String?): String =
        try {
            json.parseToJsonElement(koerper.orEmpty()).jsonObject["error"]?.jsonPrimitive?.content.orEmpty()
        } catch (_: IllegalArgumentException) { "" }

    private companion object {
        val HTTP_SUCCESS = 200..299
    }
}

/** The response to a created set as a domain value; „buffered“ is neither created nor present. */
internal fun AddSetResponse.asRecorded() = SetRecorded(
    nummer = setNumber,
    name = name,
    angelegt = action == "added",
    vorhanden = action == "exists",
    katalogOffen = katalogOffen,
    supplementPending = ergaenzung == "ausstehend",
)
