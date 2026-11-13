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
import ch.brickinventoryapp.model.data.model.AddMinifigRequest
import ch.brickinventoryapp.model.data.model.AddMinifigResponse
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.LagerortRequest
import ch.brickinventoryapp.model.data.model.LagerortResponse
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.UpdateManualItemRequest
import ch.brickinventoryapp.model.data.model.VerwendendeSetsResponse
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse

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
    override fun beobachteFiguren(suche: String?): Flow<Lokal<Minifig>> =
        ablage.beobachte(Faecher.FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

    override fun beobachteManuelleFiguren(suche: String?): Flow<Lokal<FigValuationItem>> =
        ablage.beobachte(Faecher.MANUELLE_FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

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
    override suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<LagerortResponse> =
        ablage.nachgezogen({ r -> Nachzug.FigurLagerort(figNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setFigStorage(figNumber, LagerortRequest(ort)) }
        }

    override suspend fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                           unitPrice: Double?, condition: Zustand?,
                           ownerUserId: Int?,
                           storage: String?): Ergebnis<AddMinifigResponse> =
        AddMinifigRequest(figNumber, blFigNumber, quantity, unitPrice, condition, ownerUserId, storage).let { anfrage ->
            ablage.schreibe(Bearbeitung.FigurErfassen(anfrage),
                { AddMinifigResponse(success = true, action = "gepuffert", figNumber = figNumber) }) { schluessel ->
                sicherAufrufen { api.addMinifig(anfrage, schluessel) }
            }
        }

    /**
     * Wie TeileRepository.updatePart: die Menge auch als Schritt.
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?, condition: Zustand?, owner: Int?): Ergebnis<GenericResponse> {
        val bisher = ablage.lies(Faecher.MANUELLE_FIGUREN)?.liste
            ?.firstOrNull { it.figNumber == figNumber && (owner == null || it.userId == owner) }?.quantity
        val anfrage = UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition, quantityDelta = bisher?.let { quantity - it })
        return ablage.schreibe(Bearbeitung.FigurAendern(figNumber, anfrage, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateMinifig(figNumber, anfrage, owner, schluessel) }
        }
    }

    /** Auch offline, wie TeileRepository.deletePart. */
    override suspend fun deleteMinifig(figNumber: String, owner: Int?): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.FigurLoeschen(figNumber, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deleteMinifig(figNumber, owner, schluessel) }
        }

    override suspend fun getMinifigStats(konten: Kontoauswahl?): Ergebnis<MinifigStatsResponse> =
        sicherAufrufen { api.getMinifigStats(konten?.anfrage) }

    override suspend fun getSetsMitFigur(figNumber: String,
                                konten: Kontoauswahl?): Ergebnis<VerwendendeSetsResponse> =
        sicherAufrufen { api.getSetsMitFigur(figNumber, konten?.anfrage) }
}
