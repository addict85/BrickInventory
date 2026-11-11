package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.model.AddSetResponse
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.LagerortResponse
import ch.brickinventoryapp.model.data.model.MoveSetResponse
import ch.brickinventoryapp.model.data.model.SetAggregate
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow

/**
 * Der Set-Bestand: die Galerie in der Ablage und was sie ändert. Merkliste,
 * Preisalarme, Katalogauskünfte und Dateien haben je ein eigenes Repository —
 * ein Bildschirm hängt nur an dem, was er braucht.
 */
interface SetsRepository {
    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: Zustand? = null, ownerUserId: Int? = null,
                       storage: String? = null): Ergebnis<AddSetResponse>

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null): Ergebnis<GenericResponse>

    suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<GenericResponse>

    suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse>

    /**
     * Die Galerie aus der Ablage nach Suche, Thema und Lagerort, sortiert wie am
     * Server — die Quelle der Anzeige; [aktualisiereSets] füllt sie. Die Sicht über
     * gewählte Konten ist ein eigenes Lesemodell (Kontosicht).
     */
    fun beobachteSets(suche: String? = null, thema: String? = null, lagerort: String? = null,
                      sort: Setsortierung? = null): Flow<Lokal<SetItem>>

    /** Alle Seiten der ungefilterten Galerie in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereSets(): Ergebnis<Unit>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Ergebnis<MoveSetResponse>

    /** Ein Kauf hat sich geändert; die Zusammenfassung des Servers geht in die Ablage. */
    suspend fun uebernimmZusammenfassung(agg: SetAggregate)

    /** Lagerort eines Sets setzen. Leerer Text löscht ihn. */
    suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<LagerortResponse>
}
