package ch.brickinventoryapp.data.repository

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
    suspend fun getMinifigs(accounts: String? = null, search: String? = null): Ergebnis<MinifigsResponse>

    fun beobachteFiguren(): Flow<Lokal<Minifig>>

    fun beobachteManuelleFiguren(): Flow<Lokal<FigValuationItem>>

    suspend fun getManualMinifigs(accounts: String? = null,
                                  search: String? = null): Ergebnis<ManualFigsResponse>

    suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<LagerortResponse>

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Ergebnis<AddMinifigResponse>

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun getMinifigStats(accounts: String? = null): Ergebnis<MinifigStatsResponse>

    suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String? = null): Ergebnis<VerwendendeSetsResponse>
}
