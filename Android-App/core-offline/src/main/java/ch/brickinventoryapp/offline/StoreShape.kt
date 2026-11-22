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
 * incompatible change gets a new [version]; the row carries it in the field
 * `version`, without the field it is version 1, and older versions are read by [older].
 */
internal class StoreShape<T, A>(
    private val serializer: KSerializer<A>,
    private val there: (T) -> A,
    private val her: (A) -> T,
    val version: Int = 1,
    private val older: Map<Int, (Json, JsonObject) -> T> = emptyMap(),
) {
    fun encode(json: Json, value: T): String {
        val row = json.encodeToJsonElement(serializer, there(value)).jsonObject
        return if (version == 1) row.toString() else JsonObject(row + (FIELD to JsonPrimitive(version))).toString()
    }

    fun decode(json: Json, text: String): T {
        val row = json.parseToJsonElement(text).jsonObject
        val of = row[FIELD]?.jsonPrimitive?.intOrNull ?: 1
        if (of == version) return her(json.decodeFromJsonElement(serializer, JsonObject(row - FIELD)))
        val reader = older[of] ?: throw SerializationException("Ablagezeile in Fassung $of, gelesen wird $version")
        return reader(json, JsonObject(row - FIELD))
    }

    private companion object {
        const val FIELD = "fassung"
    }
}
