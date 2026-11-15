package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.alsZusammenfassung
import ch.brickinventoryapp.model.fach.Kaufaenderung
import ch.brickinventoryapp.model.fach.Kaufkorrektur
import ch.brickinventoryapp.model.fach.EinladungAnsicht
import ch.brickinventoryapp.model.fach.HaushaltStatusAnsicht
import ch.brickinventoryapp.model.fach.KaeufeAnsicht
import ch.brickinventoryapp.model.fach.MitgliedAnsicht
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.vertrag.AcquisitionsResponse
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.aenderungFuerSet
import ch.brickinventoryapp.vertrag.aenderungFuerStueck
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.HaushaltApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Haushalt und Erfassungen — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class HaushaltRepositoryImpl @Inject constructor(
    private val api: HaushaltApi,
    private val ablage: Offlineablage,
) : HaushaltRepository {

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    override suspend fun getHousehold(): Ergebnis<HaushaltStatusAnsicht> =
        sicherAufrufen { api.getHousehold() }.abgebildet { it.alsAnsicht() }

    override suspend fun getHouseholdMembers(): Ergebnis<List<MitgliedAnsicht>> =
        sicherAufrufen { api.getHouseholdMembers() }.abgebildet { r -> r.members.map { it.alsAnsicht() } }

    override suspend fun createHouseholdInvite(): Ergebnis<EinladungAnsicht> =
        sicherAufrufen { api.createHouseholdInvite() }.zugesagt({ it.success }, { it.error }) { EinladungAnsicht(it.code.orEmpty(), it.expiresIn) }

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

    override suspend fun verwerfeGetrenntesKonto(subUserId: Int): Ergebnis<Unit> =
        sicherAufrufen { api.verwerfeGetrenntesKonto(mapOf("sub_user_id" to subUserId)) }.erledigt()

    override suspend fun getAcquisitions(setNumber: String): Ergebnis<KaeufeAnsicht> =
        sicherAufrufen { api.getAcquisitions(setNumber) }.abgebildet { it.alsKaeufe() }

    override suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?,
                                  condition: Zustand?, quantity: Int?, date: String?,
                                  ownerUserId: Int?): Ergebnis<Kaufaenderung> =
        mitZusammenfassung { api.updateAcquisition(setNumber, acqId,
            // aenderungFuerSet(): Sets tragen den Preis als `purchase_price`.
            aenderungFuerSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    override suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<Kaufaenderung> =
        mitZusammenfassung { api.deleteAcquisition(setNumber, acqId) }

    override suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<KaeufeAnsicht> =
        sicherAufrufen { api.getPartAcquisitions(partNumber, colorId) }.abgebildet { it.alsKaeufe() }

    override suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, korrektur: Kaufkorrektur): Ergebnis<Kaufaenderung> =
        mitZusammenfassung { api.updatePartAcquisition(partNumber, colorId, id, korrektur.fuerStueck()) }

    override suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deletePartAcquisition(partNumber, colorId, id) }.zugesagt({ it.success }, { null }) { }

    // Minifig acquisitions
    override suspend fun getFigAcquisitions(figNumber: String): Ergebnis<KaeufeAnsicht> =
        sicherAufrufen { api.getFigAcquisitions(figNumber) }.abgebildet { it.alsKaeufe() }

    override suspend fun updateFigAcquisition(figNumber: String, id: Int, korrektur: Kaufkorrektur): Ergebnis<Kaufaenderung> =
        mitZusammenfassung { api.updateFigAcquisition(figNumber, id, korrektur.fuerStueck()) }

    override suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deleteFigAcquisition(figNumber, id) }.zugesagt({ it.success }, { null }) { }

    /**
     * Schickt der Server die neue Summe des Sets mit, übernimmt die Ablage sie, und die
     * Kachel folgt ohne neue Liste; sonst muss der Aufrufer den Stand holen.
     */
    private suspend fun mitZusammenfassung(call: suspend () -> retrofit2.Response<GenericResponse>): Ergebnis<Kaufaenderung> =
        sicherAufrufen(call).zugesagt({ it.success }, { it.error }) { it }.let { r ->
            when (r) {
                is Ergebnis.Fehler -> r
                is Ergebnis.Erfolg -> {
                    val agg = r.data.set?.takeIf { it.setNumber.isNotBlank() }
                    agg?.let { ablage.wendeAn(Nachzug.SetZusammenfassung(it.alsZusammenfassung())) }
                    Ergebnis.Erfolg(Kaufaenderung(agg != null, r.data.parts ?: 0, r.data.minifigs ?: 0))
                }
            }
        }
}

private fun AcquisitionsResponse.alsKaeufe() = KaeufeAnsicht(acquisitions.map { it.alsAnsicht() }, totals.alsAnsicht())

private fun Kaufkorrektur.fuerStueck() =
    aenderungFuerStueck(preis = preis?.alsDouble(), condition = zustand, quantity = menge, date = datum?.toString(),
        ownerUserId = besitzer)
