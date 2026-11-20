package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.model.local.StockKind
import kotlinx.coroutines.flow.Flow

/** Was beim Abgleich geschah — die Oberfläche lädt die betroffenen Listen nach. */
sealed class Abgleichsereignis {
    data class Sent(val kinds: Set<StockKind>) : Abgleichsereignis()
}

/**
 * Was die Oberfläche vom Ausgang sieht: die Zahl offener Änderungen und was beim
 * Senden geschah. core-state kennt so weder Ablage noch Bearbeitungen.
 */
interface Baseline {
    /**
     * Eine Bearbeitung, die der Server ablehnte. Kein flüchtiges Ereignis: Sie liegt in der
     * Ablage, bis ihr Hinweis gezeigt ist. [ziel] benennt sie für den Hinweis („10001-1“);
     * [unlesbar]: nach einem Update nicht mehr lesbar, nie gesendet.
     */
    data class DiscardedChange(val id: String, val ziel: String, val meldung: String, val httpCode: Int?,
                                   val unlesbar: Boolean = false)

    fun offene(): Flow<Int>
    val events: Flow<Abgleichsereignis>
    /** Abgelehntes, dessen Hinweis noch aussteht; die älteste zuerst. */
    fun discarded(): Flow<List<DiscardedChange>>
    /** Der Hinweis zu [v] ist gezeigt. */
    suspend fun acknowledge(v: DiscardedChange)
    /** Was vom letzten Mal noch wartet, zum Senden einplanen. */
    suspend fun planeLeftover()
}
