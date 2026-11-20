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
 * Wie ein Fachmodell [T] als Zeile in der Ablage liegt: als eigene Form [A] mit Abbildung
 * in beide Richtungen. So folgt die Platte nicht jeder Änderung am Servermodell. Eine
 * unverträgliche Änderung bekommt eine neue [fassung]; die Zeile trägt sie im Feld
 * `fassung`, ohne das Feld ist es Fassung 1, und ältere Fassungen liest [older].
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
