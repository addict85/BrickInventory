package ch.brickinventoryapp.data.lokal

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** Ein wartender Eintrag; [id] steigt mit jedem Einreihen und ist damit die Reihenfolge. */
data class Ausgangsposten(
    val id: Long,
    val bearbeitung: Bearbeitung,
    val erstellt: Long,
    val versuche: Int,
)

/**
 * Änderungen, die gemacht, aber noch nicht beim Server angekommen sind — je
 * Bereich, in der Reihenfolge des Einreihens. Im Gerät eine Room-Tabelle, damit
 * sie einen Neustart der App überleben.
 */
interface Ausgang {
    fun anzahl(bereich: String): Flow<Int>
    suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long): Long
    suspend fun alle(bereich: String): List<Ausgangsposten>
    suspend fun erster(bereich: String): Ausgangsposten?
    suspend fun entferne(id: Long)
    suspend fun versuchGescheitert(id: Long)
    suspend fun leere()
}

/** Im Speicher: für Tests und als Vorgabe, solange keine Datenbank gebunden ist. */
class SpeicherAusgang : Ausgang {
    private val posten = MutableStateFlow<List<Pair<String, Ausgangsposten>>>(emptyList())
    private val naechsteId = java.util.concurrent.atomic.AtomicLong(1)

    override fun anzahl(bereich: String): Flow<Int> =
        posten.map { l -> l.count { it.first == bereich } }.distinctUntilChanged()

    override suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long): Long {
        val id = naechsteId.getAndIncrement()
        posten.update { it + (bereich to Ausgangsposten(id, bearbeitung, jetzt, 0)) }
        return id
    }

    override suspend fun alle(bereich: String) = posten.value.filter { it.first == bereich }.map { it.second }

    override suspend fun erster(bereich: String) = alle(bereich).minByOrNull { it.id }

    override suspend fun entferne(id: Long) = posten.update { l -> l.filterNot { it.second.id == id } }

    override suspend fun versuchGescheitert(id: Long) = posten.update { l ->
        l.map { if (it.second.id == id) it.first to it.second.copy(versuche = it.second.versuche + 1) else it }
    }

    override suspend fun leere() { posten.value = emptyList() }
}
