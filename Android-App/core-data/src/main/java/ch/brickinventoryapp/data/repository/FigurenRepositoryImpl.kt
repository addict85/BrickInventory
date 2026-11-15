package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.vertrag.AddMinifigRequest
import ch.brickinventoryapp.vertrag.AddMinifigResponse
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.LagerortRequest
import ch.brickinventoryapp.vertrag.UpdateManualItemRequest
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.VerwendungAnsicht
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Minifiguren aus Sets und manuell erfasste — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class FigurenRepositoryImpl @Inject constructor(
    private val api: FigurenApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : FigurenRepository {

    /** Die lokalen Listen nach dem Suchtext, wie TeileRepository.beobachteTeile. */
    override fun beobachteFiguren(suche: String?): Flow<Lokal<FigurAnsicht>> =
        ablage.beobachte(Faecher.FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null })).abgebildet { it.alsAnsicht() }

    override fun beobachteManuelleFiguren(suche: String?): Flow<Lokal<ManuelleFigurAnsicht>> =
        ablage.beobachte(Faecher.MANUELLE_FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null })).abgebildet { it.alsAnsicht() }

    override suspend fun aktualisiereFiguren(): Ergebnis<Unit> {
        // Beide Listen kommen ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort.
        val figuren = ablage.aktualisiereSeitenweise(Faecher.FIGUREN, { it.figs }, { it.figs.size }, wiederholung) { _ ->
            sicherAufrufen { api.getMinifigs(source = "set") }
        }
        if (figuren is Ergebnis.Error) return figuren
        return ablage.aktualisiereSeitenweise(Faecher.MANUELLE_FIGUREN, { it.figs }, { it.figs.size }, wiederholung) { _ ->
            sicherAufrufen { api.getManualMinifigs(null, null) }
        }
    }

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    override suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<String?> =
        ablage.nachgezogen({ r -> Nachzug.FigurLagerort(figNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setFigStorage(figNumber, LagerortRequest(storage = ort)) }
        }.zugesagt({ it.success }, { it.error }) { it.storage }

    override suspend fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                           unitPrice: Double?, condition: Zustand?,
                           ownerUserId: Int?,
                           storage: String?): Ergebnis<Erfasst> =
        AddMinifigRequest(figNumber = figNumber, blFigNumber = blFigNumber, quantity = quantity, unitPrice = unitPrice, condition = condition, ownerUserId = ownerUserId, storage = storage).let { anfrage ->
            ablage.schreibe(Bearbeitung.FigurErfassen(anfrage),
                { AddMinifigResponse(success = true, action = "gepuffert", figNumber = figNumber) }) { schluessel ->
                sicherAufrufen { api.addMinifig(anfrage, schluessel) }
            }.zugesagt({ it.success }, { it.error }) { Erfasst(it.action == "added", it.figNumber, it.priceFromCondition) }
        }

    /**
     * Wie TeileRepository.updatePart: die Menge auch als Schritt.
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?, condition: Zustand?, owner: Int?): Ergebnis<Unit> {
        val bisher = ablage.lies(Faecher.MANUELLE_FIGUREN)?.liste
            ?.firstOrNull { it.figNumber == figNumber && (owner == null || it.userId == owner) }?.quantity
        val anfrage = UpdateManualItemRequest(quantity = quantity, unitPrice = unitPrice, blFigNumber = blFigNumber, condition = condition, quantityDelta = bisher?.let { quantity - it })
        return ablage.schreibe(Bearbeitung.FigurAendern(figNumber, anfrage, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateMinifig(figNumber, anfrage, owner, schluessel) }
        }.erledigt()
    }

    /** Auch offline, wie TeileRepository.deletePart. */
    override suspend fun deleteMinifig(figNumber: String, owner: Int?): Ergebnis<Unit> =
        ablage.schreibe(Bearbeitung.FigurLoeschen(figNumber, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deleteMinifig(figNumber, owner, schluessel) }
        }.erledigt()

    override suspend fun getMinifigStats(konten: Kontoauswahl?): Ergebnis<FigurenKennzahlenAnsicht> =
        sicherAufrufen { api.getMinifigStats(konten?.anfrage) }.abgebildet { it.stats.alsAnsicht() }

    override suspend fun getSetsMitFigur(figNumber: String,
                                konten: Kontoauswahl?): Ergebnis<VerwendungAnsicht> =
        sicherAufrufen { api.getSetsMitFigur(figNumber, konten?.anfrage) }.zugesagt({ it.success }, { it.error }) { it.alsAnsicht() }
}
