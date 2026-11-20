package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Der Bestand zwischen Ablage und Server, an einer Stelle: wann er sich in der
 * Ablage geändert hat (für Kennzahlen, die der Server darüber rechnet — abgeleitet
 * aus Room, nicht gemeldet), und den Stand des Servers holen, wo ein Schreiben mehr
 * ändert, als die App selbst anwenden kann (Import, Haushalt, Besitzerwechsel).
 */
@Singleton
class Bestandsabgleich @Inject constructor(
    private val sets: SetsRepository,
    private val merkliste: WantedRepository,
    private val teile: PartsRepository,
    private val figuren: MinifigsRepository,
    private val ablage: Offlineablage,
) {
    suspend fun sets(): Ergebnis<Unit> = sets.aktualisiereSets()
    suspend fun merkliste(): Ergebnis<Unit> = merkliste.refreshWanted()
    suspend fun teile(): Ergebnis<Unit> = teile.refreshParts()
    suspend fun figuren(): Ergebnis<Unit> = figuren.refreshMinifigs()

    suspend fun bestand() {
        sets()
        teile()
        figuren()
    }

    fun setsChanged(): Flow<Unit> = ablage.altered(Slots.SETS)
    fun partsChanged(): Flow<Unit> = ablage.altered(Slots.TEILE, Slots.MANUELLE_TEILE)
    fun minifigsChanged(): Flow<Unit> = ablage.altered(Slots.FIGUREN, Slots.MANUELLE_FIGUREN)
    fun inventoryChanged(): Flow<Unit> =
        ablage.altered(Slots.SETS, Slots.TEILE, Slots.MANUELLE_TEILE, Slots.FIGUREN, Slots.MANUELLE_FIGUREN)
}
