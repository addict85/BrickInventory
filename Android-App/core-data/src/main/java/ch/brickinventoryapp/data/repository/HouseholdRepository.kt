package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.InvitationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.PurchaseChange
import ch.brickinventoryapp.model.domain.PurchaseCorrection
import ch.brickinventoryapp.model.domain.PurchasesView
/**
 * The household: members, invitations, accounts.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (HouseholdRepositoryImpl).
 */
interface HouseholdRepository {
    suspend fun getHousehold(): Outcome<HouseholdStatusView>

    suspend fun getHouseholdMembers(): Outcome<List<MemberView>>

    suspend fun createHouseholdInvite(): Outcome<InvitationView>

    suspend fun redeemHouseholdInvite(code: String, password: String, factorCode: String? = null): Outcome<Unit>

    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Outcome<Unit>

    suspend fun discardSeparateAccount(subUserId: Int): Outcome<Unit>

    suspend fun getAcquisitions(setNumber: String): Outcome<PurchasesView>

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: Condition? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Outcome<PurchaseChange>

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Outcome<PurchaseChange>

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Outcome<PurchasesView>

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, correction: PurchaseCorrection): Outcome<PurchaseChange>

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Outcome<Unit>

    suspend fun getFigAcquisitions(figNumber: String): Outcome<PurchasesView>

    suspend fun updateFigAcquisition(figNumber: String, id: Int, correction: PurchaseCorrection): Outcome<PurchaseChange>

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Outcome<Unit>
}
