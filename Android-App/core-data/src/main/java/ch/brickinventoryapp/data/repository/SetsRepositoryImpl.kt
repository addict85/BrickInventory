package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.AddSetResponse
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.LagerortRequest
import ch.brickinventoryapp.model.data.model.LagerortResponse
import ch.brickinventoryapp.model.data.model.MoveSetRequest
import ch.brickinventoryapp.model.data.model.MoveSetResponse
import ch.brickinventoryapp.model.data.model.SetAggregate
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.UpdateQuantityRequest
import ch.brickinventoryapp.model.fach.Setsortierung
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

/** Der Set-Bestand über Retrofit und Ablage; die gemeinsame Abruflogik steht in Abruf.kt. */
@Singleton
class SetsRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : SetsRepository {

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Double?,
                       condition: Zustand?, ownerUserId: Int?,
                       storage: String?): Ergebnis<AddSetResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId, storage)
        return ablage.schreibe(Bearbeitung.SetErfassen(anfrage),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { schluessel ->
            sicherAufrufen { api.addSet(anfrage, schluessel) }
        }
    }

    override suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?): Ergebnis<GenericResponse> =
        // Der Server kann deckeln (fremde Exemplare bleiben): Es gilt seine Zahl.
        ablage.nachgezogen({ r -> Nachzug.SetMengeGesetzt(setNumber, r.quantity ?: quantity).takeIf { r.success } }) {
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, null, purchasePrice, condition)) }
        }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    override suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.SetMenge(setNumber, schritt), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt), schluessel) }
        }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse> =
        ablage.nachgezogen({ r -> Nachzug.SetEntfernt(setNumber).takeIf { r.success } }) { sicherAufrufen { api.deleteSet(setNumber) } }

    /** Die Galerie aus der Ablage, nach den Filtern der Anzeige; ändert sich auch durch offline Bearbeitetes. */
    override fun beobachteSets(suche: String?, thema: String?, lagerort: String?, sort: Setsortierung?): Flow<Lokal<SetItem>> =
        ablage.beobachte(Faecher.SETS, Filterspalten(suchtext = suche?.ifBlank { null }, thema = thema?.ifBlank { null },
            lagerort = lagerort?.ifBlank { null })).map { l -> l.copy(liste = l.liste.sortiert(setOrdnung(sort))) }

    override suspend fun aktualisiereSets(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.SETS, { it.sets }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { api.getSets(null, null, null, null, seite, GALLERY_PAGE_SIZE) }
        }

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<MoveSetResponse> =
        ablage.nachgezogen({ r -> Nachzug.SetVerschoben(setNumber, fromUserId, toUserId, acquisitionIds == null).takeIf { r.success } }) {
            sicherAufrufen { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }
        }

    override suspend fun uebernimmZusammenfassung(agg: SetAggregate) {
        if (agg.setNumber.isNotBlank()) ablage.wendeAn(Nachzug.SetZusammenfassung(agg))
    }

    override suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<LagerortResponse> =
        ablage.nachgezogen({ r -> Nachzug.SetLagerort(setNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setSetStorage(setNumber, LagerortRequest(ort)) }
        }
}
