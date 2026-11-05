package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*

/**
 * Der Haushalt: Mitglieder, Einladungen, Konten.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (HaushaltRepositoryImpl).
 */
interface HaushaltRepository {
    suspend fun getHousehold(): Result<HouseholdStatusResponse>

    suspend fun getHouseholdMembers(): Result<HouseholdMembersResponse>

    suspend fun createHouseholdInvite(): Result<HouseholdInviteResponse>

    suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null): Result<GenericResponse>

    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Result<GenericResponse>

    suspend fun verwerfeGetrenntesKonto(subUserId: Int): Result<GenericResponse>

    suspend fun getAcquisitions(setNumber: String): Result<AcquisitionsResponse>

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: String? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Result<GenericResponse>

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Result<GenericResponse>

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Result<AcquisitionsResponse>

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse>

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Result<DeleteWithQuantityResponse>

    suspend fun getFigAcquisitions(figNumber: String): Result<AcquisitionsResponse>

    suspend fun updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse>

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Result<DeleteWithQuantityResponse>
}
