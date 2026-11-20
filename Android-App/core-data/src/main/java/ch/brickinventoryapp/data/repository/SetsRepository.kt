package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.SetRecorded
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Local
import kotlinx.coroutines.flow.Flow

/**
 * Der Set-Bestand: die Galerie in der Ablage und was sie ändert. Merkliste,
 * Preisalarme, Katalogauskünfte und Dateien haben je ein eigenes Repository —
 * ein Bildschirm hängt nur an dem, was er braucht.
 */
interface SetsRepository {
    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Geld? = null,
                       condition: Zustand? = null, ownerUserId: Int? = null,
                       storage: String? = null): Ergebnis<SetRecorded>

    suspend fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null): Ergebnis<Int?>

    suspend fun changeQuantityUm(setNumber: String, schritt: Int): Ergebnis<Int?>

    suspend fun deleteSet(setNumber: String): Ergebnis<Unit>

    /**
     * Die Galerie aus der Ablage nach Suche, Thema und Lagerort, sortiert wie am
     * Server — die Quelle der Anzeige; [aktualisiereSets] füllt sie. Die Sicht über
     * gewählte Konten ist ein eigenes Lesemodell (Kontosicht).
     */
    fun observeSets(suche: String? = null, thema: String? = null, lagerort: String? = null,
                      sort: Setsortierung? = null): Flow<Local<SetAnsicht>>

    /** Alle Seiten der ungefilterten Galerie in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereSets(): Ergebnis<Unit>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Ergebnis<Unit>

    /** Lagerort eines Sets setzen. Leerer Text löscht ihn. */
    suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<Unit>
}
