package ch.brickinventoryapp.data.account

import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.changeForPiece
import ch.brickinventoryapp.contract.changeForSet
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.local.asSummary
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.InvitationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.PurchaseChange
import ch.brickinventoryapp.model.domain.PurchaseCorrection
import ch.brickinventoryapp.model.domain.PurchasesView
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Household and acquisitions — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
internal class HouseholdRepositoryImpl @Inject constructor(
    private val api: HouseholdApi,
    private val store: OfflineStore,
) : HouseholdRepository {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    override suspend fun getHousehold(): Outcome<HouseholdStatusView> =
        safeCall { api.getHousehold() }.mapData { it.asView() }

    override suspend fun getHouseholdMembers(): Outcome<List<MemberView>> =
        safeCall { api.getHouseholdMembers() }.mapData { r -> r.members.map { it.asView() } }

    override suspend fun createHouseholdInvite(): Outcome<InvitationView> =
        safeCall { api.createHouseholdInvite() }.promised({ it.success }) { InvitationView(it.code.orEmpty(), it.expiresIn) }

    /**
     * [password]: the current password of the redeeming account — the server checks it.
     * [factorCode]: with an active second factor its code; only sent if present.
     */
    override suspend fun redeemHouseholdInvite(code: String, password: String, factorCode: String?): Outcome<Unit> =
        safeCall {
            api.redeemHouseholdInvite(mapOf("code" to code, "password" to password) +
                listOfNotNull(factorCode?.trim()?.takeIf { it.isNotEmpty() }?.let { "faktor_code" to it }))
        }.done()

    /**
     * [subUserId]: unlink a sub-account. [mainUserId]: unlink oneself from this one
     * parent account. Without either the server unlinks all own parent accounts.
     */
    override suspend fun unlinkHousehold(subUserId: Int?, mainUserId: Int?): Outcome<Unit> =
        safeCall {
            api.unlinkHousehold(buildMap {
                subUserId?.let { put("sub_user_id", it) }
                mainUserId?.let { put("main_user_id", it) }
            })
        }.done()

    override suspend fun discardSeparateAccount(subUserId: Int): Outcome<Unit> =
        safeCall { api.discardSeparateAccount(mapOf("sub_user_id" to subUserId)) }.done()

    override suspend fun getAcquisitions(setNumber: String): Outcome<PurchasesView> =
        safeCall { api.getAcquisitions(setNumber) }.mapData { it.asPurchases() }

    override suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?,
                                  condition: Condition?, quantity: Int?, date: String?,
                                  ownerUserId: Int?): Outcome<PurchaseChange> =
        withSummary { api.updateAcquisition(setNumber, acqId,
            // changeForSet(): sets carry the price as `purchase_price`.
            changeForSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    override suspend fun deleteAcquisition(setNumber: String, acqId: Int): Outcome<PurchaseChange> =
        withSummary { api.deleteAcquisition(setNumber, acqId) }

    override suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Outcome<PurchasesView> =
        safeCall { api.getPartAcquisitions(partNumber, colorId) }.mapData { it.asPurchases() }

    override suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, correction: PurchaseCorrection): Outcome<PurchaseChange> =
        withSummary { api.updatePartAcquisition(partNumber, colorId, id, correction.forPiece()) }

    override suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Outcome<Unit> =
        safeCall { api.deletePartAcquisition(partNumber, colorId, id) }.promised({ it.success }, { null }) { }

    // Minifig acquisitions
    override suspend fun getFigAcquisitions(figNumber: String): Outcome<PurchasesView> =
        safeCall { api.getFigAcquisitions(figNumber) }.mapData { it.asPurchases() }

    override suspend fun updateFigAcquisition(figNumber: String, id: Int, correction: PurchaseCorrection): Outcome<PurchaseChange> =
        withSummary { api.updateFigAcquisition(figNumber, id, correction.forPiece()) }

    override suspend fun deleteFigAcquisition(figNumber: String, id: Int): Outcome<Unit> =
        safeCall { api.deleteFigAcquisition(figNumber, id) }.promised({ it.success }, { null }) { }

    /**
     * If the server sends the set's new sum along, the store takes it over, and the
     * tile follows without a new list; otherwise the caller must fetch the state.
     */
    private suspend fun withSummary(call: suspend () -> retrofit2.Response<GenericResponse>): Outcome<PurchaseChange> =
        safeCall(call).promised({ it.success }) { it }.let { r ->
            when (r) {
                is Outcome.Failure -> r
                is Outcome.Success -> {
                    val agg = r.data.set?.takeIf { it.setNumber.isNotBlank() }
                    agg?.let { store.applyChange(FollowUp.SetSummary(it.asSummary())) }
                    Outcome.Success(PurchaseChange(agg != null, r.data.parts, r.data.minifigs))
                }
            }
        }
}

private fun AcquisitionsResponse.asPurchases() = PurchasesView(acquisitions.map { it.asView() }, totals.asView())

private fun PurchaseCorrection.forPiece() =
    changeForPiece(price = price?.asDouble(), condition = condition, quantity = quantity, date = datum?.toString(),
        ownerUserId = owner)
