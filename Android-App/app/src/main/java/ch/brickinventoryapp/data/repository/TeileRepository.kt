package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Teile, Minifiguren und Farben.
 *
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.teile.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class TeileRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null): Result<PartsResponse> =
        // Manuell erfasste Teile haben ihren eigenen Bereich — die Set-Teileliste
        // schließt sie aus (wie in der Webapp).
        // Nur die ungefilterte erste Seite wird gecacht — sie ist das, was nach
        // einem Neustart gebraucht wird. Für Suchergebnisse wäre ein Cache
        // wertlos und würde nur Platz belegen.
        // Auch hier: gecacht wird nur die ungefilterte Sicht (siehe getSets).
        if (search.isNullOrBlank() && color == null && category == null && page == 1 && accounts == null)
            cached("parts", PartsResponse.serializer()) {
                safeCall { api.getParts(null, null, null, 1, pageSize = 500, excludeManual = "1") }
            }
        else safeCall { api.getParts(search, color, category, page, pageSize = 500,
                                     excludeManual = "1", accounts = accounts) }

    suspend fun getPartsStats(accounts: String? = null): Result<PartsStatsResponse> =
        safeCall { api.getPartsStats(accounts) }

    suspend fun getBrickColors(): Result<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    suspend fun addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, note: String? = null, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null): Result<AddPartResponse> =
        safeCall { api.addPart(AddPartRequest(partNumber, colorId, colorName, colorHex, quantity, note, unitPrice, condition, ownerUserId)) }

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updatePart(partNumber, colorId, UpdateManualItemRequest(quantity, unitPrice, condition = condition)) }

    suspend fun deletePart(partNumber: String, colorId: Int): Result<GenericResponse> =
        safeCall { api.deletePart(partNumber, colorId) }

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1, note: String? = null,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null): Result<AddMinifigResponse> =
        safeCall { api.addMinifig(AddMinifigRequest(figNumber, blFigNumber, quantity, note, unitPrice, condition, ownerUserId)) }

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateMinifig(figNumber, UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition)) }

    suspend fun deleteMinifig(figNumber: String): Result<GenericResponse> =
        safeCall { api.deleteMinifig(figNumber) }

    suspend fun getMinifigs(accounts: String? = null): Result<MinifigsResponse> =
        if (accounts == null)
            cached("minifigs", MinifigsResponse.serializer()) { safeCall { api.getMinifigs() } }
        else safeCall { api.getMinifigs(accounts = accounts) }

    suspend fun getMinifigStats(accounts: String? = null): Result<ch.brickinventoryapp.data.model.MinifigStatsResponse> =
        safeCall { api.getMinifigStats(accounts) }

    suspend fun getMinifigParts(figNumber: String): Result<PartsResponse> =
        safeCall { api.getMinifigParts(figNumber) }

    suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }

    // Admin-level: saves global default (Monitoring)
    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition)) }

    // User-level: saves per-user default (empty string = revert to global)
    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
}
