package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.data.asRecorded
import ch.brickinventoryapp.contract.LagerortRequest
import ch.brickinventoryapp.contract.MengeGeaendert
import ch.brickinventoryapp.contract.MoveSetRequest
import ch.brickinventoryapp.contract.UpdateQuantityRequest
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Der Set-Bestand über Retrofit und Ablage; die gemeinsame Abruflogik steht in Abruf.kt. */
@Singleton
class SetsRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : SetsRepository {

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Geld?,
                       condition: Zustand?, ownerUserId: Int?,
                       storage: String?): Ergebnis<SetRecorded> {
        val wish = Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice, zustand = condition,
            besitzer = ownerUserId, lagerort = storage)
        val anfrage = wish.asRequest()
        return ablage.schreibe(Editing.SetErfassen(wish),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { schluessel ->
            sicherAufrufen { api.addSet(anfrage, schluessel) }
        }.promised({ it.success }) { it.asRecorded() }
    }

    override suspend fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?): Ergebnis<Int?> =
        // Der Server kann deckeln (fremde Exemplare bleiben): Es gilt seine Zahl.
        ablage.nachgezogen({ r -> FollowUp.SetQuantitySet(setNumber, r.quantity ?: quantity).takeIf { r.success } }) {
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity = quantity, quantityDelta = null, purchasePrice = purchasePrice, condition = condition)) }
        }.promised({ it.success }) { it.quantity }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    override suspend fun changeQuantityUm(setNumber: String, schritt: Int): Ergebnis<Int?> =
        ablage.schreibe(Editing.SetMenge(setNumber, schritt), { MengeGeaendert(success = true) }) { schluessel ->
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt), schluessel) }
        }.promised({ it.success }) { it.quantity }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.SetRemoved(setNumber).takeIf { r.success } }) { sicherAufrufen { api.deleteSet(setNumber) } }.erledigt()

    /** Die Galerie aus der Ablage, nach den Filtern der Anzeige; ändert sich auch durch offline Bearbeitetes. */
    override fun observeSets(suche: String?, thema: String?, lagerort: String?, sort: Setsortierung?): Flow<Local<SetAnsicht>> =
        ablage.observe(Slots.SETS, Filterspalten(suchtext = suche?.ifBlank { null }, thema = thema?.ifBlank { null },
            lagerort = lagerort?.ifBlank { null })).map { l -> l.copy(liste = l.liste.sortiert(setOrder(sort))) }

    override suspend fun aktualisiereSets(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.SETS, { r -> r.sets.map { it.alsAnsicht() } }, { it.total }, retry) { seite ->
            sicherAufrufen { api.getSets(null, null, null, null, seite, GALLERY_PAGE_SIZE) }
        }

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.SetMoved(setNumber, fromUserId, toUserId, acquisitionIds == null).takeIf { r.success } }) {
            sicherAufrufen { api.moveSet(setNumber, MoveSetRequest(fromUserId = fromUserId, toUserId = toUserId, acquisitionIds = acquisitionIds)) }
        }.promised({ it.success }) { }

    override suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.SetLocation(setNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setSetStorage(setNumber, LagerortRequest(storage = ort)) }
        }.promised({ it.success }) { }
}
