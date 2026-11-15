package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.alsAnfrage
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.AddSetResponse
import ch.brickinventoryapp.model.fach.SetErfasst
import ch.brickinventoryapp.data.alsErfasst
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.LagerortRequest
import ch.brickinventoryapp.vertrag.MoveSetRequest
import ch.brickinventoryapp.vertrag.UpdateQuantityRequest
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

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Geld?,
                       condition: Zustand?, ownerUserId: Int?,
                       storage: String?): Ergebnis<SetErfasst> {
        val wunsch = Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice, zustand = condition,
            besitzer = ownerUserId, lagerort = storage)
        val anfrage = wunsch.alsAnfrage()
        return ablage.schreibe(Bearbeitung.SetErfassen(wunsch),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { schluessel ->
            sicherAufrufen { api.addSet(anfrage, schluessel) }
        }.zugesagt({ it.success }, { it.error }) { it.alsErfasst() }
    }

    override suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?): Ergebnis<Int?> =
        // Der Server kann deckeln (fremde Exemplare bleiben): Es gilt seine Zahl.
        ablage.nachgezogen({ r -> Nachzug.SetMengeGesetzt(setNumber, r.quantity ?: quantity).takeIf { r.success } }) {
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity = quantity, quantityDelta = null, purchasePrice = purchasePrice, condition = condition)) }
        }.zugesagt({ it.success }, { it.error }) { it.quantity }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    override suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<Int?> =
        ablage.schreibe(Bearbeitung.SetMenge(setNumber, schritt), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt), schluessel) }
        }.zugesagt({ it.success }, { it.error }) { it.quantity }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> Nachzug.SetEntfernt(setNumber).takeIf { r.success } }) { sicherAufrufen { api.deleteSet(setNumber) } }.erledigt()

    /** Die Galerie aus der Ablage, nach den Filtern der Anzeige; ändert sich auch durch offline Bearbeitetes. */
    override fun beobachteSets(suche: String?, thema: String?, lagerort: String?, sort: Setsortierung?): Flow<Lokal<SetAnsicht>> =
        ablage.beobachte(Faecher.SETS, Filterspalten(suchtext = suche?.ifBlank { null }, thema = thema?.ifBlank { null },
            lagerort = lagerort?.ifBlank { null })).map { l -> l.copy(liste = l.liste.sortiert(setOrdnung(sort))) }

    override suspend fun aktualisiereSets(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.SETS, { r -> r.sets.map { it.alsAnsicht() } }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { api.getSets(null, null, null, null, seite, GALLERY_PAGE_SIZE) }
        }

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> Nachzug.SetVerschoben(setNumber, fromUserId, toUserId, acquisitionIds == null).takeIf { r.success } }) {
            sicherAufrufen { api.moveSet(setNumber, MoveSetRequest(fromUserId = fromUserId, toUserId = toUserId, acquisitionIds = acquisitionIds)) }
        }.zugesagt({ it.success }, { it.error }) { }

    override suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> Nachzug.SetLagerort(setNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setSetStorage(setNumber, LagerortRequest(storage = ort)) }
        }.zugesagt({ it.success }, { it.error }) { }
}
