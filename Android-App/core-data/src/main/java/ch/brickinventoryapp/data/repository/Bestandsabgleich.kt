package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.Faecher
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
    private val merkliste: MerklisteRepository,
    private val teile: TeileRepository,
    private val figuren: FigurenRepository,
    private val ablage: Offlineablage,
) {
    suspend fun sets(): Ergebnis<Unit> = sets.aktualisiereSets()
    suspend fun merkliste(): Ergebnis<Unit> = merkliste.aktualisiereMerkliste()
    suspend fun teile(): Ergebnis<Unit> = teile.aktualisiereTeile()
    suspend fun figuren(): Ergebnis<Unit> = figuren.aktualisiereFiguren()

    suspend fun bestand() {
        sets()
        teile()
        figuren()
    }

    fun setsGeaendert(): Flow<Unit> = ablage.veraendert(Faecher.SETS)
    fun teileGeaendert(): Flow<Unit> = ablage.veraendert(Faecher.TEILE, Faecher.MANUELLE_TEILE)
    fun figurenGeaendert(): Flow<Unit> = ablage.veraendert(Faecher.FIGUREN, Faecher.MANUELLE_FIGUREN)
    fun bestandGeaendert(): Flow<Unit> =
        ablage.veraendert(Faecher.SETS, Faecher.TEILE, Faecher.MANUELLE_TEILE, Faecher.FIGUREN, Faecher.MANUELLE_FIGUREN)
}
