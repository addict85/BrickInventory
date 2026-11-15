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
 * `fassung`, ohne das Feld ist es Fassung 1, und ältere Fassungen liest [aeltere].
 */
internal class Ablageform<T, A>(
    private val serializer: KSerializer<A>,
    private val hin: (T) -> A,
    private val her: (A) -> T,
    val fassung: Int = 1,
    private val aeltere: Map<Int, (Json, JsonObject) -> T> = emptyMap(),
) {
    fun kodiere(json: Json, wert: T): String {
        val zeile = json.encodeToJsonElement(serializer, hin(wert)).jsonObject
        return if (fassung == 1) zeile.toString() else JsonObject(zeile + (FELD to JsonPrimitive(fassung))).toString()
    }

    fun dekodiere(json: Json, text: String): T {
        val zeile = json.parseToJsonElement(text).jsonObject
        val von = zeile[FELD]?.jsonPrimitive?.intOrNull ?: 1
        if (von == fassung) return her(json.decodeFromJsonElement(serializer, JsonObject(zeile - FELD)))
        val leser = aeltere[von] ?: throw SerializationException("Ablagezeile in Fassung $von, gelesen wird $fassung")
        return leser(json, JsonObject(zeile - FELD))
    }

    private companion object {
        const val FELD = "fassung"
    }
}
