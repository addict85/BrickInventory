package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.HaushaltApi
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
 * Haushalt und Erfassungen — eines der Sachgebiete der Datenschicht, erreichbar
 * über `repo.haushalt.…`; die Begründung der Aufteilung steht in RepoBasis.kt.
 */
@Singleton
class HaushaltRepository @Inject constructor(
    api: HaushaltApi,
    cache: ResponseCache,
) : RepoBasis<HaushaltApi>(api, cache) {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    suspend fun getHousehold(): Result<HouseholdStatusResponse> =
        safeCall { api.getHousehold() }

    suspend fun getHouseholdMembers(): Result<HouseholdMembersResponse> =
        safeCall { api.getHouseholdMembers() }

    suspend fun createHouseholdInvite(): Result<HouseholdInviteResponse> =
        safeCall { api.createHouseholdInvite() }

    /** [passwort]: das aktuelle Passwort des einlösenden Kontos — der Server prüft es. */
    suspend fun redeemHouseholdInvite(code: String, passwort: String): Result<GenericResponse> =
        safeCall { api.redeemHouseholdInvite(mapOf("code" to code, "password" to passwort)) }

    /**
     * [subUserId]: ein Unterkonto lösen. [mainUserId]: sich von diesem einen
     * Elternkonto lösen. Ohne beides löst der Server alle eigenen Elternkonten.
     */
    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Result<GenericResponse> =
        safeCall {
            api.unlinkHousehold(buildMap {
                subUserId?.let { put("sub_user_id", it) }
                mainUserId?.let { put("main_user_id", it) }
            })
        }

    suspend fun verwerfeGetrenntesKonto(subUserId: Int): Result<GenericResponse> =
        safeCall { api.verwerfeGetrenntesKonto(mapOf("sub_user_id" to subUserId)) }

    suspend fun getAcquisitions(setNumber: String): Result<AcquisitionsResponse> =
        safeCall { api.getAcquisitions(setNumber) }

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: String? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.updateAcquisition(setNumber, acqId,
            // fuerSet(): Sets tragen den Preis als `purchase_price` — Erklärung am Modell.
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
