package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.model.*

/**
 * Der Haushalt: Mitglieder, Einladungen, Konten.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (HaushaltRepositoryImpl).
 */
interface HaushaltRepository {
    suspend fun getHousehold(): Ergebnis<HouseholdStatusResponse>

    suspend fun getHouseholdMembers(): Ergebnis<HouseholdMembersResponse>

    suspend fun createHouseholdInvite(): Ergebnis<HouseholdInviteResponse>

    suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null): Ergebnis<GenericResponse>

    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Ergebnis<GenericResponse>

    suspend fun verwerfeGetrenntesKonto(subUserId: Int): Ergebnis<GenericResponse>

    suspend fun getAcquisitions(setNumber: String): Ergebnis<AcquisitionsResponse>

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: String? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Ergebnis<GenericResponse>

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<GenericResponse>

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<AcquisitionsResponse>

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Ergebnis<GenericResponse>

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<DeleteWithQuantityResponse>

    suspend fun getFigAcquisitions(figNumber: String): Ergebnis<AcquisitionsResponse>

    suspend fun updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Ergebnis<GenericResponse>

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<DeleteWithQuantityResponse>
}
