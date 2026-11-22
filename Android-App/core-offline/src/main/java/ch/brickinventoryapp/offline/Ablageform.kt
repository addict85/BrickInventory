package ch.brickinventoryapp.offline

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * How a domain model [T] lies as a row in the store: as its own form [A] with mapping
 * in both directions. This way the disk does not follow every change to the server model. An
 * incompatible change gets a new [fassung]; the row carries it in the field
 * `fassung`, without the field it is version 1, and older versions are read by [older].
 */
internal class Ablageform<T, A>(
    private val serializer: KSerializer<A>,
    private val hin: (T) -> A,
    private val her: (A) -> T,
    val fassung: Int = 1,
    private val older: Map<Int, (Json, JsonObject) -> T> = emptyMap(),
) {
    fun encode(json: Json, wert: T): String {
        val zeile = json.encodeToJsonElement(serializer, hin(wert)).jsonObject
        return if (fassung == 1) zeile.toString() else JsonObject(zeile + (FIELD to JsonPrimitive(fassung))).toString()
    }

    fun decode(json: Json, text: String): T {
        val zeile = json.parseToJsonElement(text).jsonObject
        val von = zeile[FIELD]?.jsonPrimitive?.intOrNull ?: 1
        if (von == fassung) return her(json.decodeFromJsonElement(serializer, JsonObject(zeile - FIELD)))
        val reader = older[von] ?: throw SerializationException("Ablagezeile in Fassung $von, gelesen wird $fassung")
        return reader(json, JsonObject(zeile - FIELD))
    }

    private companion object {
        const val FIELD = "fassung"
    }
}
