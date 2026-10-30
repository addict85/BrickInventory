package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.decodeFromString
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Minifiguren aus Sets und manuell erfasste. Erreichbar über `repo.figuren.…`.
 */
@Singleton
class FigurenRepository @Inject constructor(
    api: FigurenApi,
    cache: ResponseCache,
) : RepoBasis<FigurenApi>(api, cache) {

    /**
     * Set-Figuren der Übersicht; Suche beim Server wie im Web, weil er vor der
     * Gruppierung über jede fig_name-Zeile sucht. Gecacht wird nur die ungefilterte
     * Sicht, sonst wäre ein Suchergebnis nach dem Neustart die ganze Sammlung.
     */
    suspend fun getMinifigs(accounts: String? = null, search: String? = null): Result<MinifigsResponse> =
        if (accounts == null && search.isNullOrBlank())
            cached("minifigs", MinifigsResponse.serializer()) {
                safeCall { api.getMinifigs(source = "set") }
            }
        else safeCall { api.getMinifigs(source = "set", accounts = accounts,
                                        search = search?.ifBlank { null }) }

    suspend fun getManualMinifigs(accounts: String? = null,
                                  search: String? = null): Result<ManualFigsResponse> =
        safeCall { api.getManualMinifigs(accounts, search) }

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    suspend fun setFigStorage(figNumber: String, ort: String): Result<LagerortResponse> =
        safeCall { api.setFigStorage(figNumber, LagerortRequest(ort)) }

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Result<AddMinifigResponse> =
        safeCall { api.addMinifig(AddMinifigRequest(figNumber, blFigNumber, quantity, unitPrice,
                                                    condition, ownerUserId, storage)) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.updateMinifig(figNumber, UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition), owner) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.deleteMinifig(figNumber, owner) }

    suspend fun getMinifigStats(accounts: String? = null): Result<ch.brickinventoryapp.data.model.MinifigStatsResponse> =
        safeCall { api.getMinifigStats(accounts) }

    suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String? = null): Result<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitFigur(figNumber, accounts) }
}
