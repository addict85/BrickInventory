package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.model.lokal.Bestandsart
import kotlinx.coroutines.flow.Flow

/** Was beim Abgleich geschah — die Oberfläche lädt nach oder zeigt einen Hinweis. */
sealed class Abgleichsereignis {
    data class Gesendet(val arten: Set<Bestandsart>) : Abgleichsereignis()
    /** [ziel] benennt die Bearbeitung für den Hinweis („Set 10001-1“). */
    data class Verworfen(val ziel: String, val meldung: String, val httpCode: Int?) : Abgleichsereignis()
}

/**
 * Was die Oberfläche vom Ausgang sieht: die Zahl offener Änderungen und was beim
 * Senden geschah. core-zustand kennt so weder Ablage noch Bearbeitungen.
 */
interface Ausgangslage {
    fun offene(): Flow<Int>
    val ereignisse: Flow<Abgleichsereignis>
    /** Was vom letzten Mal noch wartet, zum Senden einplanen. */
    suspend fun planeLiegengebliebenes()
}
