package ch.brickinventoryapp.offline

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/**
 * Wie ein Fachmodell [T] als Zeile in der Ablage liegt: als eigene Form [A] mit
 * Abbildung in beide Richtungen. So folgt das, was auf der Platte steht, nicht
 * jeder Änderung am Servermodell — eine umbenannte Eigenschaft dort macht
 * abgelegte Zeilen nicht unlesbar.
 */
internal class Ablageform<T, A>(
    private val serializer: KSerializer<A>,
    private val hin: (T) -> A,
    private val her: (A) -> T,
) {
    fun kodiere(json: Json, wert: T): String = json.encodeToString(serializer, hin(wert))

    fun dekodiere(json: Json, text: String): T = her(json.decodeFromString(serializer, text))

    companion object {
        /** Für Listen, deren Modell nur die App kennt oder die der Server nicht ändert. */
        fun <T> direkt(serializer: KSerializer<T>): Ablageform<T, T> = Ablageform(serializer, { it }, { it })
    }
}
