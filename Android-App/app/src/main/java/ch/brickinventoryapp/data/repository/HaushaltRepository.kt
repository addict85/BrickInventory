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
 * Haushalt und Erfassungen.
 *
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.haushalt.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class HaushaltRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    suspend fun getHousehold(): Result<HouseholdStatusResponse> =
        safeCall { api.getHousehold() }

    suspend fun getHouseholdMembers(): Result<HouseholdMembersResponse> =
        safeCall { api.getHouseholdMembers() }

    suspend fun createHouseholdInvite(): Result<HouseholdInviteResponse> =
        safeCall { api.createHouseholdInvite() }

    suspend fun redeemHouseholdInvite(code: String): Result<GenericResponse> =
        safeCall { api.redeemHouseholdInvite(mapOf("code" to code)) }

    /** subUserId leer = die eigene Verknüpfung lösen (als Unterkonto). */
    suspend fun unlinkHousehold(subUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.unlinkHousehold(subUserId?.let { mapOf("sub_user_id" to it) } ?: emptyMap()) }

    suspend fun getAcquisitions(setNumber: String): Result<AcquisitionsResponse> =
        safeCall { api.getAcquisitions(setNumber) }

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: String? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.updateAcquisition(setNumber, acqId,
            // fuerSet(): Sets tragen den Preis als `purchase_price` — siehe die
            // Erklärung am Modell (Nachtrag 111).
            UpdateAcquisitionRequest.fuerSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Result<GenericResponse> =
        safeCall { api.deleteAcquisition(setNumber, acqId) }

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Result<AcquisitionsResponse> =
        safeCall { api.getPartAcquisitions(partNumber, colorId) }

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
        safeCall { api.updatePartAcquisition(partNumber, colorId, id, req) }

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Result<DeleteWithQuantityResponse> =
        safeCall { api.deletePartAcquisition(partNumber, colorId, id) }

    // Minifig acquisitions
    suspend fun getFigAcquisitions(figNumber: String): Result<AcquisitionsResponse> =
        safeCall { api.getFigAcquisitions(figNumber) }

    suspend fun updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
        safeCall { api.updateFigAcquisition(figNumber, id, req) }

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Result<DeleteWithQuantityResponse> =
        safeCall { api.deleteFigAcquisition(figNumber, id) }
}
