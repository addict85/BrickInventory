package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The stock between store and server, in one place: when it changed in the
 * store (for key figures the server computes over it — derived
 * from Room, not reported), and fetching the server's state where a write changes more
 * than the app can apply itself (import, household, owner change).
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
