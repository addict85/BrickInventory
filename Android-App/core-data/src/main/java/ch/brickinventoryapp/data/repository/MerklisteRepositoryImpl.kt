package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.MerkpostenAntwort
import ch.brickinventoryapp.contract.MerkpostenInhaberRequest
import ch.brickinventoryapp.contract.MerkpostenUebernahmeRequest
import ch.brickinventoryapp.model.domain.Merksortierung
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

/** The wishlist via Retrofit and store. */
@Singleton
class MerklisteRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : WantedRepository {

    override fun observeWanted(suche: String?, zustand: Zustand?, sort: Merksortierung?): Flow<Local<WantedItemView>> =
        ablage.observe(Slots.MERKLISTE, Filterspalten(suchtext = suche?.ifBlank { null }, zustand = zustand?.kennung))
            .map { l -> l.copy(liste = l.liste.sortiert(rememberOrder(sort))) }

    /** The wishlist comes whole, without pages: the total is the length of the response. */
    override suspend fun refreshWanted(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.MERKLISTE, { r -> r.merkposten.map { it.alsAnsicht() } }, { it.merkposten.size }, retry) { _ ->
            sicherAufrufen { api.getMerkliste(null, null, null, null) }
        }

    override suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                          ownerUserId: Int?): Ergebnis<Boolean> {
        val wish = Merkwunsch(setNumber, condition, ownerUserId)
        val anfrage = wish.asRequest()
        return ablage.schreibe(Editing.MerkpostenAnlegen(wish), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { schluessel -> sicherAufrufen { api.legeMerkpostenAn(anfrage, schluessel) } }.shown { it.warNeu }
    }

    override suspend fun moveWantedItem(setNumber: String, condition: Zustand,
                                              ofId: Int, toId: Int): Ergebnis<Boolean> =
        ablage.nachgezogen({ r -> FollowUp.WantedItemMoved(setNumber, condition, ofId, toId).takeIf { r.success } }) {
            sicherAufrufen { api.moveWantedItem(setNumber, condition.kennung, MerkpostenInhaberRequest(ownerUserId = ofId, neuerInhaber = toId)) }
        }.promised({ it.success }) { it.zusammengefuehrt }

    override suspend fun deleteWantedItem(setNumber: String, condition: Zustand,
                                           ownerUserId: Int?): Ergebnis<Unit> =
        ablage.schreibe(Editing.MerkpostenLoeschen(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deleteWantedItem(setNumber, condition.kennung, ownerUserId, schluessel) }
        }.withoutContent()

    override suspend fun getWantedItemPrices(setNumber: String): Ergebnis<WantedItemPricesView> =
        sicherAufrufen { api.getWantedItemPrices(setNumber) }.promised({ it.success }, { null }) { it.alsAnsicht() }

    override suspend fun adoptWantedItem(setNumber: String, condition: Zustand, quantity: Int,
                                             purchasePrice: Geld?, recordedAs: Zustand?,
                                             ownerUserId: Int?,
                                             storage: String?): Ergebnis<Boolean> {
        val wish = Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice, zustand = recordedAs ?: condition,
            besitzer = ownerUserId, lagerort = storage)
        return ablage.nachgezogen({ r -> FollowUp.WantedItemAdopted(setNumber, condition, ownerUserId, wish).takeIf { r.success } }) {
            sicherAufrufen { api.adoptWantedItem(setNumber, condition.kennung,
                MerkpostenUebernahmeRequest(quantity = quantity, purchasePrice = purchasePrice?.asDouble(), condition = recordedAs, ownerUserId = ownerUserId, storage = storage)) }
        }.shown { it.action == "exists" }
    }
}
