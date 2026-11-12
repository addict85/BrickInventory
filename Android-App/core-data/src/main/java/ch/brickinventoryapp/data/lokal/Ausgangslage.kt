package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.model.lokal.Bestandsart
import kotlinx.coroutines.flow.Flow

/** Was beim Abgleich geschah — die Oberfläche lädt die betroffenen Listen nach. */
sealed class Abgleichsereignis {
    data class Gesendet(val arten: Set<Bestandsart>) : Abgleichsereignis()
}

/**
 * Was die Oberfläche vom Ausgang sieht: die Zahl offener Änderungen und was beim
 * Senden geschah. core-zustand kennt so weder Ablage noch Bearbeitungen.
 */
interface Ausgangslage {
    /**
     * Eine Bearbeitung, die der Server ablehnte. Kein flüchtiges Ereignis: Sie liegt in der
     * Ablage, bis ihr Hinweis gezeigt ist. [ziel] benennt sie für den Hinweis („10001-1“).
     */
    data class VerworfeneAenderung(val id: String, val ziel: String, val meldung: String, val httpCode: Int?)

    fun offene(): Flow<Int>
    val ereignisse: Flow<Abgleichsereignis>
    /** Abgelehntes, dessen Hinweis noch aussteht; die älteste zuerst. */
    fun verworfene(): Flow<List<VerworfeneAenderung>>
    /** Der Hinweis zu [v] ist gezeigt. */
    suspend fun quittiere(v: VerworfeneAenderung)
    /** Was vom letzten Mal noch wartet, zum Senden einplanen. */
    suspend fun planeLiegengebliebenes()
}
