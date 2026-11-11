package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.*
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
) : FigurenRepository {

    /**
     * Set-Figuren der Übersicht; Suche beim Server wie im Web, weil er vor der
     * Gruppierung über jede fig_name-Zeile sucht. Abgelegt wird nur die
     * ungefilterte Sicht; ohne Netz sucht dieselbe Suche in ihr.
     */
    override suspend fun getMinifigs(accounts: String?, search: String?): Ergebnis<MinifigsResponse> {
        val filter = Filterspalten(suchtext = search?.ifBlank { null })
        val ausLokal = { l: List<Minifig> -> MinifigsResponse(success = true, figs = l) }
        return when {
            accounts != null -> sicherAufrufen { api.getMinifigs(source = "set", accounts = accounts, search = filter.suchtext) }
            filter == Filterspalten() -> ablage.abgeglichen(Faecher.FIGUREN, { it.figs }, ausLokal) {
                sicherAufrufen { api.getMinifigs(source = "set") }
            }
            else -> ablage.gefiltert(Faecher.FIGUREN, filter, ausLokal) { sicherAufrufen { api.getMinifigs(source = "set", search = filter.suchtext) } }
        }
    }

    /** Die lokalen Listen nach dem Suchtext, wie TeileRepository.beobachteTeile. */
    override fun beobachteFiguren(suche: String?): Flow<Lokal<Minifig>> =
        ablage.beobachte(Faecher.FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

    override fun beobachteManuelleFiguren(suche: String?): Flow<Lokal<FigValuationItem>> =
        ablage.beobachte(Faecher.MANUELLE_FIGUREN, Filterspalten(suchtext = suche?.ifBlank { null }))

    override suspend fun aktualisiereFiguren(): Ergebnis<Unit> {
        // Beide Listen kommen ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort.
        val figuren = ablage.aktualisiereSeitenweise(Faecher.FIGUREN, { it.figs }, { it.figs.size }) { _ ->
            sicherAufrufen { api.getMinifigs(source = "set") }
        }
        if (figuren is Ergebnis.Error) return figuren
        return ablage.aktualisiereSeitenweise(Faecher.MANUELLE_FIGUREN, { it.figs }, { it.figs.size }) { _ ->
            sicherAufrufen { api.getManualMinifigs(null, null) }
        }
    }

    override suspend fun getManualMinifigs(accounts: String?,
                                  search: String?): Ergebnis<ManualFigsResponse> {
        val filter = Filterspalten(suchtext = search?.ifBlank { null })
        val ausLokal = { l: List<FigValuationItem> -> ManualFigsResponse(success = true, figs = l) }
        return when {
            accounts != null -> sicherAufrufen { api.getManualMinifigs(accounts, search) }
            filter == Filterspalten() -> ablage.abgeglichen(Faecher.MANUELLE_FIGUREN, { it.figs }, ausLokal) {
                sicherAufrufen { api.getManualMinifigs(accounts, search) }
            }
            else -> ablage.gefiltert(Faecher.MANUELLE_FIGUREN, filter, ausLokal) { sicherAufrufen { api.getManualMinifigs(accounts, search) } }
        }
    }

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    override suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<LagerortResponse> =
        sicherAufrufen { api.setFigStorage(figNumber, LagerortRequest(ort)) }

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

    override suspend fun getMinifigStats(accounts: String?): Ergebnis<MinifigStatsResponse> =
        sicherAufrufen { api.getMinifigStats(accounts) }

    override suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String?): Ergebnis<VerwendendeSetsResponse> =
        sicherAufrufen { api.getSetsMitFigur(figNumber, accounts) }
}
