package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.alsAnfrage
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenPreiseAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAntwort
import ch.brickinventoryapp.vertrag.MerkpostenInhaberRequest
import ch.brickinventoryapp.vertrag.MerkpostenUebernahmeRequest
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Die Merkliste über Retrofit und Ablage. */
@Singleton
class MerklisteRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : MerklisteRepository {

    override fun beobachteMerkliste(suche: String?, zustand: Zustand?, sort: Merksortierung?): Flow<Lokal<MerkpostenAnsicht>> =
        ablage.beobachte(Faecher.MERKLISTE, Filterspalten(suchtext = suche?.ifBlank { null }, zustand = zustand?.kennung))
            .map { l -> l.copy(liste = l.liste.sortiert(merkOrdnung(sort))) }

    /** Die Merkliste kommt ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun aktualisiereMerkliste(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.MERKLISTE, { r -> r.merkposten.map { it.alsAnsicht() } }, { it.merkposten.size }, wiederholung) { _ ->
            sicherAufrufen { api.getMerkliste(null, null, null, null) }
        }

    override suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                          ownerUserId: Int?): Ergebnis<Boolean> {
        val wunsch = Merkwunsch(setNumber, condition, ownerUserId)
        val anfrage = wunsch.alsAnfrage()
        return ablage.schreibe(Bearbeitung.MerkpostenAnlegen(wunsch), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { schluessel -> sicherAufrufen { api.legeMerkpostenAn(anfrage, schluessel) } }.abgebildet { it.warNeu }
    }

    override suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                              vonId: Int, zuId: Int): Ergebnis<Boolean> =
        ablage.nachgezogen({ r -> Nachzug.MerkpostenVerschoben(setNumber, condition, vonId, zuId).takeIf { r.success } }) {
            sicherAufrufen { api.verschiebeMerkposten(setNumber, condition.kennung, MerkpostenInhaberRequest(ownerUserId = vonId, neuerInhaber = zuId)) }
        }.zugesagt({ it.success }) { it.zusammengefuehrt }

    override suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                                           ownerUserId: Int?): Ergebnis<Unit> =
        ablage.schreibe(Bearbeitung.MerkpostenLoeschen(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.loescheMerkposten(setNumber, condition.kennung, ownerUserId, schluessel) }
        }.ohneInhalt()

    override suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseAnsicht> =
        sicherAufrufen { api.getMerkpostenPreise(setNumber) }.zugesagt({ it.success }, { null }) { it.alsAnsicht() }

    override suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int,
                                             purchasePrice: Geld?, erfasstAls: Zustand?,
                                             ownerUserId: Int?,
                                             storage: String?): Ergebnis<Boolean> {
        val wunsch = Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice, zustand = erfasstAls ?: condition,
            besitzer = ownerUserId, lagerort = storage)
        return ablage.nachgezogen({ r -> Nachzug.MerkpostenUebernommen(setNumber, condition, ownerUserId, wunsch).takeIf { r.success } }) {
            sicherAufrufen { api.uebernimmMerkposten(setNumber, condition.kennung,
                MerkpostenUebernahmeRequest(quantity = quantity, purchasePrice = purchasePrice?.alsDouble(), condition = erfasstAls, ownerUserId = ownerUserId, storage = storage)) }
        }.abgebildet { it.action == "exists" }
    }
}
