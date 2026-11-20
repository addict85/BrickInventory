package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.local.asSummary
import ch.brickinventoryapp.model.domain.Kaufaenderung
import ch.brickinventoryapp.model.domain.Kaufkorrektur
import ch.brickinventoryapp.model.domain.InvitationView
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.PurchasesView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.changeForSet
import ch.brickinventoryapp.contract.changeForPiece
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.api.HouseholdApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Haushalt und Erfassungen — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class HaushaltRepositoryImpl @Inject constructor(
    private val api: HouseholdApi,
    private val ablage: Offlineablage,
) : HouseholdRepository {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    override suspend fun getHousehold(): Ergebnis<HouseholdStatusView> =
        sicherAufrufen { api.getHousehold() }.shown { it.alsAnsicht() }

    override suspend fun getHouseholdMembers(): Ergebnis<List<MemberView>> =
        sicherAufrufen { api.getHouseholdMembers() }.shown { r -> r.members.map { it.alsAnsicht() } }

    override suspend fun createHouseholdInvite(): Ergebnis<InvitationView> =
        sicherAufrufen { api.createHouseholdInvite() }.promised({ it.success }) { InvitationView(it.code.orEmpty(), it.expiresIn) }

    /**
     * [passwort]: das aktuelle Passwort des einlösenden Kontos — der Server prüft es.
     * [faktorCode]: bei aktivem zweitem Faktor dessen Code; nur mitgeschickt, wenn da.
     */
    override suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String?): Ergebnis<Unit> =
        sicherAufrufen {
            api.redeemHouseholdInvite(mapOf("code" to code, "password" to passwort) +
                listOfNotNull(faktorCode?.trim()?.takeIf { it.isNotEmpty() }?.let { "faktor_code" to it }))
        }.erledigt()

    /**
     * [subUserId]: ein Unterkonto lösen. [mainUserId]: sich von diesem einen
     * Elternkonto lösen. Ohne beides löst der Server alle eigenen Elternkonten.
     */
    override suspend fun unlinkHousehold(subUserId: Int?, mainUserId: Int?): Ergebnis<Unit> =
        sicherAufrufen {
            api.unlinkHousehold(buildMap {
                subUserId?.let { put("sub_user_id", it) }
                mainUserId?.let { put("main_user_id", it) }
            })
        }.erledigt()

    override suspend fun discardSeparateAccount(subUserId: Int): Ergebnis<Unit> =
        sicherAufrufen { api.discardSeparateAccount(mapOf("sub_user_id" to subUserId)) }.erledigt()

    override suspend fun getAcquisitions(setNumber: String): Ergebnis<PurchasesView> =
        sicherAufrufen { api.getAcquisitions(setNumber) }.shown { it.asPurchases() }

    override suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?,
                                  condition: Zustand?, quantity: Int?, date: String?,
                                  ownerUserId: Int?): Ergebnis<Kaufaenderung> =
        withSummary { api.updateAcquisition(setNumber, acqId,
            // changeForSet(): Sets tragen den Preis als `purchase_price`.
            changeForSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    override suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<Kaufaenderung> =
        withSummary { api.deleteAcquisition(setNumber, acqId) }

    override suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<PurchasesView> =
        sicherAufrufen { api.getPartAcquisitions(partNumber, colorId) }.shown { it.asPurchases() }

    override suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, correction: Kaufkorrektur): Ergebnis<Kaufaenderung> =
        withSummary { api.updatePartAcquisition(partNumber, colorId, id, correction.forPiece()) }

    override suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deletePartAcquisition(partNumber, colorId, id) }.promised({ it.success }, { null }) { }

    // Minifig acquisitions
    override suspend fun getFigAcquisitions(figNumber: String): Ergebnis<PurchasesView> =
        sicherAufrufen { api.getFigAcquisitions(figNumber) }.shown { it.asPurchases() }

    override suspend fun updateFigAcquisition(figNumber: String, id: Int, correction: Kaufkorrektur): Ergebnis<Kaufaenderung> =
        withSummary { api.updateFigAcquisition(figNumber, id, correction.forPiece()) }

    override suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deleteFigAcquisition(figNumber, id) }.promised({ it.success }, { null }) { }

    /**
     * Schickt der Server die neue Summe des Sets mit, übernimmt die Ablage sie, und die
     * Kachel folgt ohne neue Liste; sonst muss der Aufrufer den Stand holen.
     */
    private suspend fun withSummary(call: suspend () -> retrofit2.Response<GenericResponse>): Ergebnis<Kaufaenderung> =
        sicherAufrufen(call).promised({ it.success }) { it }.let { r ->
            when (r) {
                is Ergebnis.Fehler -> r
                is Ergebnis.Erfolg -> {
                    val agg = r.data.set?.takeIf { it.setNumber.isNotBlank() }
                    agg?.let { ablage.applyAn(FollowUp.SetSummary(it.asSummary())) }
                    Ergebnis.Erfolg(Kaufaenderung(agg != null, r.data.parts, r.data.minifigs))
                }
            }
        }
}

private fun AcquisitionsResponse.asPurchases() = PurchasesView(acquisitions.map { it.alsAnsicht() }, totals.alsAnsicht())

private fun Kaufkorrektur.forPiece() =
    changeForPiece(preis = preis?.asDouble(), condition = zustand, quantity = menge, date = datum?.toString(),
        ownerUserId = besitzer)
