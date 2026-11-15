package ch.brickinventoryapp.offline

import ch.brickinventoryapp.offline.Ausgang.VerworfenerPosten
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * Ein wartender Eintrag; [id] steigt mit jedem Einreihen und ist damit die Reihenfolge.
 * [schluessel] geht als Idempotency-Key mit: Kam ein Versuch an, nur die Antwort
 * nicht, wirkt die Wiederholung beim Server kein zweites Mal.
 */
data class Ausgangsposten(
    val id: Long,
    val bearbeitung: Bearbeitung,
    val erstellt: Long,
    val versuche: Int,
    val schluessel: String,
)

/**
 * Änderungen, die gemacht, aber noch nicht beim Server angekommen sind — je
 * Bereich, in der Reihenfolge des Einreihens. Im Gerät eine Room-Tabelle, damit
 * sie einen Neustart der App überleben.
 */
interface Ausgang {
    /**
     * Eine Bearbeitung, die der Server ablehnte; [ziel] benennt sie für den Hinweis („10001-1“).
     * [unlesbar]: Der Posten liess sich nach einem Update nicht mehr lesen und ging nie hinaus.
     */
    data class VerworfenerPosten(val id: String, val ziel: String, val meldung: String, val httpCode: Int?,
                                 val unlesbar: Boolean = false)

    fun anzahl(bereich: String): Flow<Int>
    suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long, schluessel: String): Long
    /** Nur lesbare Posten; Lesen ändert nichts, Unlesbares räumt erst [raeumeUnlesbare]. */
    suspend fun alle(bereich: String): List<Ausgangsposten>
    suspend fun erster(bereich: String): Ausgangsposten?

    /**
     * Unlesbare Posten als verworfen melden und dann entfernen — nie still: Sie tragen
     * Änderungen, die es nur auf diesem Gerät gibt. Gibt ihre Zahl zurück.
     */
    suspend fun raeumeUnlesbare(bereich: String): Int
    suspend fun entferne(id: Long)
    suspend fun versuchGescheitert(id: Long)
    suspend fun leere()

    /** Verworfenes bleibt, bis sein Hinweis gezeigt ist — auch über einen Neustart. */
    suspend fun merkeVerworfen(bereich: String, v: VerworfenerPosten)
    fun verworfene(bereich: String): Flow<List<VerworfenerPosten>>
    suspend fun quittiereVerworfen(bereich: String, id: String)
}

/** Im Speicher: für Tests und als Vorgabe, solange keine Datenbank gebunden ist. */
class SpeicherAusgang : Ausgang {
    private val posten = MutableStateFlow<List<Pair<String, Ausgangsposten>>>(emptyList())
    private val naechsteId = java.util.concurrent.atomic.AtomicLong(1)
    private val verworfen = MutableStateFlow<List<Pair<String, VerworfenerPosten>>>(emptyList())

    override fun anzahl(bereich: String): Flow<Int> =
        posten.map { l -> l.count { it.first == bereich } }.distinctUntilChanged()

    override suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long, schluessel: String): Long {
        val id = naechsteId.getAndIncrement()
        posten.update { it + (bereich to Ausgangsposten(id, bearbeitung, jetzt, 0, schluessel)) }
        return id
    }

    override suspend fun alle(bereich: String) = posten.value.filter { it.first == bereich }.map { it.second }

    override suspend fun erster(bereich: String) = alle(bereich).minByOrNull { it.id }

    /** Im Speicher liegt nichts in Textform, also nichts Unlesbares. */
    override suspend fun raeumeUnlesbare(bereich: String) = 0

    override suspend fun entferne(id: Long) = posten.update { l -> l.filterNot { it.second.id == id } }

    override suspend fun versuchGescheitert(id: Long) = posten.update { l ->
        l.map { if (it.second.id == id) it.first to it.second.copy(versuche = it.second.versuche + 1) else it }
    }

    override suspend fun leere() {
        posten.value = emptyList()
        verworfen.value = emptyList()
    }

    override suspend fun merkeVerworfen(bereich: String, v: VerworfenerPosten) =
        verworfen.update { l -> l.filterNot { it.first == bereich && it.second.id == v.id } + (bereich to v) }

    override fun verworfene(bereich: String): Flow<List<VerworfenerPosten>> =
        verworfen.map { l -> l.filter { it.first == bereich }.map { it.second } }.distinctUntilChanged()

    override suspend fun quittiereVerworfen(bereich: String, id: String) =
        verworfen.update { l -> l.filterNot { it.first == bereich && it.second.id == id } }
}
