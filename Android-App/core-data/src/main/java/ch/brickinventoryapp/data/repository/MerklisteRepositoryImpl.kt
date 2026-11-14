package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAntwort
import ch.brickinventoryapp.vertrag.MerkpostenInhaberAntwort
import ch.brickinventoryapp.vertrag.MerkpostenInhaberRequest
import ch.brickinventoryapp.vertrag.MerkpostenPreiseResponse
import ch.brickinventoryapp.vertrag.MerkpostenRequest
import ch.brickinventoryapp.vertrag.MerkpostenUebernahmeRequest
import ch.brickinventoryapp.vertrag.MerkpostenUebernahmeResponse
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

    override fun beobachteMerkliste(suche: String?, zustand: Zustand?, sort: Merksortierung?): Flow<Lokal<Merkposten>> =
        ablage.beobachte(Faecher.MERKLISTE, Filterspalten(suchtext = suche?.ifBlank { null }, zustand = zustand?.kennung))
            .map { l -> l.copy(liste = l.liste.sortiert(merkOrdnung(sort))) }

    /** Die Merkliste kommt ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun aktualisiereMerkliste(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.MERKLISTE, { it.merkposten }, { it.merkposten.size }, wiederholung) { _ ->
            sicherAufrufen { api.getMerkliste(null, null, null, null) }
        }

    override suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                          ownerUserId: Int?): Ergebnis<MerkpostenAntwort> {
        val anfrage = MerkpostenRequest(setNumber, condition, ownerUserId)
        return ablage.schreibe(Bearbeitung.MerkpostenAnlegen(anfrage), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { schluessel -> sicherAufrufen { api.legeMerkpostenAn(anfrage, schluessel) } }
    }

    override suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                              vonId: Int, zuId: Int): Ergebnis<MerkpostenInhaberAntwort> =
        ablage.nachgezogen({ r -> Nachzug.MerkpostenVerschoben(setNumber, condition, vonId, zuId).takeIf { r.success } }) {
            sicherAufrufen { api.verschiebeMerkposten(setNumber, condition.kennung, MerkpostenInhaberRequest(vonId, zuId)) }
        }

    override suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                                           ownerUserId: Int?): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.MerkpostenLoeschen(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.loescheMerkposten(setNumber, condition.kennung, ownerUserId, schluessel) }
        }

    override suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseResponse> =
        sicherAufrufen { api.getMerkpostenPreise(setNumber) }

    override suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int,
                                             purchasePrice: Double?, erfasstAls: Zustand?,
                                             ownerUserId: Int?,
                                             storage: String?): Ergebnis<MerkpostenUebernahmeResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, erfasstAls ?: condition, ownerUserId, storage)
        return ablage.nachgezogen({ r -> Nachzug.MerkpostenUebernommen(setNumber, condition, ownerUserId, anfrage).takeIf { r.success } }) {
            sicherAufrufen { api.uebernimmMerkposten(setNumber, condition.kennung,
                MerkpostenUebernahmeRequest(quantity, purchasePrice, erfasstAls, ownerUserId, storage)) }
        }
    }
}
