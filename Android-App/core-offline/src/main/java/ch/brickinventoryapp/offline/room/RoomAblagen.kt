package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.Ausgangsposten
import ch.brickinventoryapp.offline.InitialForm
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.model.lokal.StockKind
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.offline.LocalRow
import ch.brickinventoryapp.offline.LocalInventory
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject

/** [LocalInventory] über Room: Zeilen und Stand je Bereich und Art. */
internal class RoomInventory @Inject constructor(private val db: InventoryDatabase) : LocalInventory {
    private val dao get() = db.bestand()

    override fun observe(bereich: String, art: StockKind): Flow<Local<LocalRow>> =
        combine(dao.observe(bereich, art.name), dao.observeStatus(bereich, art.name)) { zeilen, stand ->
            Local(zeilen.map(::asLocal), stand)
        }

    override suspend fun lies(bereich: String, art: StockKind) =
        Local(dao.lies(bereich, art.name).map(::asLocal), dao.stand(bereich, art.name))

    override suspend fun filtere(bereich: String, art: StockKind, filter: Filterspalten): Local<LocalRow> {
        val f = filter
        val zeilen = dao.filtere(bereich, art.name, f.suchtext?.let(::containsPattern), f.thema, f.lagerort, f.farbe,
            f.kategorie, f.ersatzteil, f.zustand)
        return Local(zeilen.map(::asLocal), dao.stand(bereich, art.name))
    }

    override suspend fun ersetze(bereich: String, art: StockKind, zeilen: List<LocalRow>, stand: Long?) =
        dao.ersetze(bereich, art.name,
            // Doppelte Schlüssel verletzten den Primärschlüssel; die spätere Zeile gilt.
            zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> asRow(z, bereich, art, i) },
            stand)

    override suspend fun sameAn(bereich: String, art: StockKind, zeilen: List<LocalRow>) =
        dao.sameAn(bereich, art.name, zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> asRow(z, bereich, art, i) })

    override suspend fun cleanOther(bereich: String) {
        dao.deleteOtherRows(bereich)
        dao.deleteOtherStates(bereich)
    }

    override suspend fun leere() {
        dao.emptyRows()
        dao.emptyStates()
    }
}

private fun asLocal(z: InventoryRow) = with(z) {
    LocalRow(schluessel, inhalt, Filterspalten(suchtext, thema, lagerort, farbe, kategorie, ersatzteil, zustand))
}

private fun asRow(z: LocalRow, bereich: String, art: StockKind, position: Int) = with(z.spalten) {
    InventoryRow(bereich, art.name, z.schluessel, position, z.inhalt, suchtext.orEmpty(), thema, lagerort, farbe, kategorie,
        ersatzteil, zustand)
}

/** „Enthält“ als LIKE-Muster; `%`, `_` und `\` gelten wörtlich wie beim Server (likeSuche.ts). */
internal fun containsPattern(suche: String): String =
    "%" + suche.lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

/**
 * [Ausgang] über Room; jeder Posten liegt in der [InitialForm]. Lesen schreibt nie:
 * Ein unlesbarer Posten bleibt liegen, bis [cleanUnreadable] ihn als verworfen meldet.
 */
internal class RoomExit @Inject constructor(
    private val db: InventoryDatabase,
    private val json: Json = BrickJson,
) : Ausgang {
    private val dao get() = db.ausgang()

    override fun anzahl(bereich: String) = dao.anzahl(bereich)

    override suspend fun einreihen(bereich: String, bearbeitung: Editing, jetzt: Long, schluessel: String) =
        dao.addOne(ExitRow(bereich = bereich, bearbeitung = InitialForm.encode(json, bearbeitung),
            erstellt = jetzt, schluessel = schluessel))

    override suspend fun alle(bereich: String) = dao.alle(bereich).mapNotNull { lies(it) }

    override suspend fun erster(bereich: String): Ausgangsposten? = dao.alle(bereich).firstNotNullOfOrNull { lies(it) }

    override suspend fun cleanUnreadable(bereich: String): Int {
        val unlesbar = dao.alle(bereich).filter { lies(it) == null }
        for (z in unlesbar) {
            // Erst den Hinweis festhalten, dann entfernen: Stirbt der Prozess dazwischen, bleibt der Hinweis.
            val ziel = InitialForm.targetFrom(json, z.bearbeitung) ?: "?"
            rememberDiscarded(bereich, DiscardedItem(z.schluessel.ifBlank { "posten-${z.id}" }, ziel, "", null, unlesbar = true))
            dao.entferne(z.id)
        }
        return unlesbar.size
    }

    override suspend fun entferne(id: Long) = dao.entferne(id)
    override suspend fun attemptFailed(id: Long) = dao.attemptFailed(id)
    override suspend fun leere() = dao.leere()

    // Verworfenes liegt als eigene Art in der Tabelle `bestand`: dauerhaft ohne neues Schema,
    // und Abmelden (Bestand leeren) räumt es mit.
    private val bestand get() = db.bestand()

    override suspend fun rememberDiscarded(bereich: String, v: DiscardedItem) {
        val position = bestand.lies(bereich, DISCARDED).maxOfOrNull { it.position }?.plus(1) ?: 0
        val inhalt = json.encodeToString(DiscardedRow.serializer(), DiscardedRow(v.ziel, v.meldung, v.httpCode, v.unlesbar))
        bestand.deleteKeys(bereich, DISCARDED, listOf(v.id))
        bestand.addOne(listOf(InventoryRow(bereich, DISCARDED, v.id, position, inhalt)))
    }

    override fun discarded(bereich: String): Flow<List<DiscardedItem>> =
        bestand.observe(bereich, DISCARDED).map { zeilen ->
            zeilen.mapNotNull { z ->
                runCatching { json.decodeFromString(DiscardedRow.serializer(), z.inhalt) }.getOrNull()
                    ?.let { DiscardedItem(z.schluessel, it.ziel, it.meldung, it.httpCode, it.unlesbar) }
            }
        }

    override suspend fun acknowledgeDiscarded(bereich: String, id: String) = bestand.deleteKeys(bereich, DISCARDED, listOf(id))

    private fun lies(z: ExitRow): Ausgangsposten? =
        runCatching { InitialForm.decode(json, z.bearbeitung) }.getOrNull()
            ?.let { Ausgangsposten(z.id, it, z.erstellt, z.versuche, z.schluessel) }
}

/** Die Art, unter der verworfene Posten in `bestand` liegen; keine [StockKind] heisst so. */
internal const val DISCARDED = "AUSGANG_VERWORFEN"

@Serializable
internal data class DiscardedRow(val ziel: String, val meldung: String, val httpCode: Int? = null, val unlesbar: Boolean = false)
