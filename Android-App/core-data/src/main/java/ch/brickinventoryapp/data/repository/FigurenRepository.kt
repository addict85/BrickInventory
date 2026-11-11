package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.*
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse
import kotlinx.coroutines.flow.Flow

/**
 * Minifiguren: Bestand und manuell erfasste Figuren.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FigurenRepositoryImpl).
 */
interface FigurenRepository {
    /** Die Figuren aus der Ablage nach dem Suchtext; [aktualisiereFiguren] füllt sie. */
    fun beobachteFiguren(suche: String? = null): Flow<Lokal<Minifig>>

    fun beobachteManuelleFiguren(suche: String? = null): Flow<Lokal<FigValuationItem>>

    /** Set-Figuren und manuelle Figuren in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereFiguren(): Ergebnis<Unit>

    suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<LagerortResponse>

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Double? = null, condition: Zustand? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Ergebnis<AddMinifigResponse>

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: Zustand? = null, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun getMinifigStats(accounts: String? = null): Ergebnis<MinifigStatsResponse>

    suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String? = null): Ergebnis<VerwendendeSetsResponse>
}
