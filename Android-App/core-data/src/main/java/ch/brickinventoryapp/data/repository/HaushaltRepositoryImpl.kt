package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.HaushaltApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.model.data.model.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Haushalt und Erfassungen — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class HaushaltRepositoryImpl @Inject constructor(
    api: HaushaltApi,
    cache: ResponseCache,
) : RepoBasis<HaushaltApi>(api, cache), HaushaltRepository {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    override suspend fun getHousehold(): Ergebnis<HouseholdStatusResponse> =
        safeCall { api.getHousehold() }

    override suspend fun getHouseholdMembers(): Ergebnis<HouseholdMembersResponse> =
        safeCall { api.getHouseholdMembers() }

    override suspend fun createHouseholdInvite(): Ergebnis<HouseholdInviteResponse> =
        safeCall { api.createHouseholdInvite() }

    /**
     * [passwort]: das aktuelle Passwort des einlösenden Kontos — der Server prüft es.
     * [faktorCode]: bei aktivem zweitem Faktor dessen Code; nur mitgeschickt, wenn da.
     */
    override suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String?): Ergebnis<GenericResponse> =
        safeCall {
            api.redeemHouseholdInvite(mapOf("code" to code, "password" to passwort) +
                listOfNotNull(faktorCode?.trim()?.takeIf { it.isNotEmpty() }?.let { "faktor_code" to it }))
        }

    /**
     * [subUserId]: ein Unterkonto lösen. [mainUserId]: sich von diesem einen
     * Elternkonto lösen. Ohne beides löst der Server alle eigenen Elternkonten.
     */
    override suspend fun unlinkHousehold(subUserId: Int?, mainUserId: Int?): Ergebnis<GenericResponse> =
        safeCall {
            api.unlinkHousehold(buildMap {
                subUserId?.let { put("sub_user_id", it) }
                mainUserId?.let { put("main_user_id", it) }
            })
        }

    override suspend fun verwerfeGetrenntesKonto(subUserId: Int): Ergebnis<GenericResponse> =
        safeCall { api.verwerfeGetrenntesKonto(mapOf("sub_user_id" to subUserId)) }

    override suspend fun getAcquisitions(setNumber: String): Ergebnis<AcquisitionsResponse> =
        safeCall { api.getAcquisitions(setNumber) }

    override suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?,
                                  condition: Zustand?, quantity: Int?, date: String?,
                                  ownerUserId: Int?): Ergebnis<GenericResponse> =
        safeCall { api.updateAcquisition(setNumber, acqId,
            // fuerSet(): Sets tragen den Preis als `purchase_price` — Erklärung am Modell.
            UpdateAcquisitionRequest.fuerSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    override suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<GenericResponse> =
        safeCall { api.deleteAcquisition(setNumber, acqId) }

    override suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<AcquisitionsResponse> =
        safeCall { api.getPartAcquisitions(partNumber, colorId) }

    override suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Ergebnis<GenericResponse> =
        safeCall { api.updatePartAcquisition(partNumber, colorId, id, req) }

    override suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<DeleteWithQuantityResponse> =
        safeCall { api.deletePartAcquisition(partNumber, colorId, id) }

    // Minifig acquisitions
    override suspend fun getFigAcquisitions(figNumber: String): Ergebnis<AcquisitionsResponse> =
        safeCall { api.getFigAcquisitions(figNumber) }

    override suspend fun updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Ergebnis<GenericResponse> =
        safeCall { api.updateFigAcquisition(figNumber, id, req) }

    override suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<DeleteWithQuantityResponse> =
        safeCall { api.deleteFigAcquisition(figNumber, id) }
}
