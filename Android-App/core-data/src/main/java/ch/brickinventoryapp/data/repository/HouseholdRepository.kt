package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Kaufaenderung
import ch.brickinventoryapp.model.domain.Kaufkorrektur
import ch.brickinventoryapp.model.domain.InvitationView
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.PurchasesView
import ch.brickinventoryapp.model.domain.MemberView

import ch.brickinventoryapp.model.domain.Zustand
/**
 * The household: members, invitations, accounts.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (HaushaltRepositoryImpl).
 */
interface HouseholdRepository {
    suspend fun getHousehold(): Ergebnis<HouseholdStatusView>

    suspend fun getHouseholdMembers(): Ergebnis<List<MemberView>>

    suspend fun createHouseholdInvite(): Ergebnis<InvitationView>

    suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null): Ergebnis<Unit>

    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Ergebnis<Unit>

    suspend fun discardSeparateAccount(subUserId: Int): Ergebnis<Unit>

    suspend fun getAcquisitions(setNumber: String): Ergebnis<PurchasesView>

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: Zustand? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Ergebnis<Kaufaenderung>

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<Kaufaenderung>

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<PurchasesView>

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, correction: Kaufkorrektur): Ergebnis<Kaufaenderung>

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<Unit>

    suspend fun getFigAcquisitions(figNumber: String): Ergebnis<PurchasesView>

    suspend fun updateFigAcquisition(figNumber: String, id: Int, correction: Kaufkorrektur): Ergebnis<Kaufaenderung>

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<Unit>
}
