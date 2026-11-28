package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.transformWhile
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
 * Create a set — with progress, like the web app via /api/v2/sets/add-stream
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
     * no cancel button. The last step is always Done, Failure or NoConnection.
     */
    override fun create(
        setNumber: String, quantity: Int, purchasePrice: Money?,
        condition: Condition?, ownerUserId: Int?, storage: String?,
    ): Flow<SetCreateStep> {
        // Address and token are set by the client's guard, as for every fetch.
        val request = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v2/sets/add-stream")
            .header("Accept", "text/event-stream")
            .post(createBody(setNumber, quantity, purchasePrice, condition, ownerUserId, storage))
            .build()
        return sseStream(client, request) { json.parseToJsonElement(it).jsonObject }.transformWhile { e ->
            val step = when (e) {
                is SseEvent.Data -> step(e.value)
                // An unreadable event could be the „done“; an end without it leaves open
                // whether the set was created. Both are an abort, not a sentence of the server.
                is SseEvent.Unreadable, SseEvent.Ended -> SetCreateStep.Failure("")
                is SseEvent.StreamFailed -> withoutStream(e)
            }
            if (step != null) emit(step)
            !step.isLast()
        }.flowOn(io)
    }

    private fun SetCreateStep?.isLast() =
        this is SetCreateStep.Done || this is SetCreateStep.Failure || this == SetCreateStep.NoConnection

    /**
     * Built by hand instead of via a data class: fields that are not set are missing
     * in the body — the server distinguishes „no purchase price“ from „purchase price null“. Free
     * text goes through the serializer, otherwise a quotation mark would break the body.
     */
    private fun createBody(
        setNumber: String, quantity: Int, purchasePrice: Money?,
        condition: Condition?, ownerUserId: Int?, storage: String?,
    ): RequestBody {
        val fields = buildList {
            add("\"set_number\":${json.encodeToString(kotlinx.serialization.serializer(), setNumber)}")
            add("\"quantity\":$quantity")
            if (purchasePrice != null) add("\"purchase_price\":$purchasePrice")
            if (condition != null) add("\"condition\":\"${condition.identifier}\"")
            if (ownerUserId != null) add("\"owner_user_id\":$ownerUserId")
            if (!storage.isNullOrBlank())
                add("\"storage\":${json.encodeToString(kotlinx.serialization.serializer(), storage)}")
        }
        return "{${fields.joinToString(",")}}"
            .toRequestBody("application/json; charset=utf-8".toMediaType())
    }

    /**
     * An event of the stream; null for unknown ones. The same step names as in the
     * web app (`public/js/collection.js`): a protocol between two programs.
     */
    private fun step(obj: JsonObject): SetCreateStep? = when (obj["step"]?.jsonPrimitive?.content) {
        "meta" -> SetCreateStep.MasterData(obj["set"]?.jsonPrimitive?.content)
        "image" -> SetCreateStep.Image
        "done_meta" -> SetCreateStep.FastDone
        "done" -> done(obj.toString())
        "error" -> SetCreateStep.Failure(obj["error"]?.jsonPrimitive?.content.orEmpty())
        else -> null
    }

    /**
     * Without an event stream: the request never arrived, the server refused, or it answered
     * in the JSON form (the set was already in view). Only „never arrived“ may be
     * retried via the outbox; an abort in the middle of the stream could create twice.
     */
    private fun withoutStream(e: SseEvent.StreamFailed): SetCreateStep {
        val code = e.code
        return when {
            code == null -> if (e.noConnection) SetCreateStep.NoConnection else SetCreateStep.Failure("")
            code in HTTP_SUCCESS && e.body != null -> done(e.body)
            else -> SetCreateStep.Failure(errorTextFrom(e.body))
        }
    }

    private fun done(text: String): SetCreateStep = try {
        val r = json.decodeFromString(AddSetResponse.serializer(), text)
        if (r.success) SetCreateStep.Done(r.asRecorded()) else SetCreateStep.Failure(errorTextFrom(text))
    } catch (_: IllegalArgumentException) {
        // A refusal carries only success and the sentence, not the fields of a created set.
        SetCreateStep.Failure(errorTextFrom(text))
    }

    /** Get the sentence the server sent from an error response. */
    private fun errorTextFrom(bodyBytes: String?): String =
        try {
            json.parseToJsonElement(bodyBytes.orEmpty()).jsonObject["error"]?.jsonPrimitive?.content.orEmpty()
        } catch (_: IllegalArgumentException) { "" }

    private companion object {
        val HTTP_SUCCESS = 200..299
    }
}

/** The response to a created set as a domain value; „buffered“ is neither created nor present. */
internal fun AddSetResponse.asRecorded() = SetRecorded(
    number = setNumber,
    name = name,
    created = action == "added",
    present = action == "exists",
    catalogOpen = catalogPending,
    supplementPending = supplement == "pending",
)
