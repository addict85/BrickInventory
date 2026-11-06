package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.model.MinifigStatsResponse

/**
 * Minifiguren aus Sets und manuell erfasste — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class FigurenRepositoryImpl @Inject constructor(
    api: FigurenApi,
    cache: ResponseCache,
    ablage: Offlineablage,
) : RepoBasis<FigurenApi>(api, cache, ablage), FigurenRepository {

    /**
     * Set-Figuren der Übersicht; Suche beim Server wie im Web, weil er vor der
     * Gruppierung über jede fig_name-Zeile sucht. Gecacht wird nur die ungefilterte
     * Sicht, sonst wäre ein Suchergebnis nach dem Neustart die ganze Sammlung.
     */
    override suspend fun getMinifigs(accounts: String?, search: String?): Ergebnis<MinifigsResponse> =
        if (accounts == null && search.isNullOrBlank())
            abgeglichen(Faecher.FIGUREN, { it.figs }, { MinifigsResponse(success = true, figs = it) }) {
                safeCall { api.getMinifigs(source = "set") }
            }
        else safeCall { api.getMinifigs(source = "set", accounts = accounts,
                                        search = search?.ifBlank { null }) }

    /** Die lokalen Listen (ungefiltert), wie TeileRepository.beobachteTeile. */
    override fun beobachteFiguren(): Flow<Lokal<Minifig>> = ablage.beobachte(Faecher.FIGUREN)
    override fun beobachteManuelleFiguren(): Flow<Lokal<FigValuationItem>> = ablage.beobachte(Faecher.MANUELLE_FIGUREN)

    override suspend fun getManualMinifigs(accounts: String?,
                                  search: String?): Ergebnis<ManualFigsResponse> =
        if (accounts == null && search.isNullOrBlank())
            abgeglichen(Faecher.MANUELLE_FIGUREN, { it.figs }, { ManualFigsResponse(success = true, figs = it) }) {
                safeCall { api.getManualMinifigs(accounts, search) }
            }
        else safeCall { api.getManualMinifigs(accounts, search) }

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    override suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<LagerortResponse> =
        safeCall { api.setFigStorage(figNumber, LagerortRequest(ort)) }

    override suspend fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                           unitPrice: Double?, condition: String?,
                           ownerUserId: Int?,
                           storage: String?): Ergebnis<AddMinifigResponse> =
        AddMinifigRequest(figNumber, blFigNumber, quantity, unitPrice, condition, ownerUserId, storage).let { anfrage ->
            schreibe(Bearbeitung.FigurErfassen(anfrage),
                { AddMinifigResponse(success = true, action = "gepuffert", figNumber = figNumber) }) { schluessel ->
                safeCall { api.addMinifig(anfrage, schluessel) }
            }
        }

    /**
     * Wie TeileRepository.updatePart: die Menge auch als Schritt.
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?, condition: String?, owner: Int?): Ergebnis<GenericResponse> {
        val bisher = ablage.lies(Faecher.MANUELLE_FIGUREN)?.liste
            ?.firstOrNull { it.figNumber == figNumber && (owner == null || it.userId == owner) }?.quantity
        val anfrage = UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition, quantityDelta = bisher?.let { quantity - it })
        return schreibe(Bearbeitung.FigurAendern(figNumber, anfrage, owner), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.updateMinifig(figNumber, anfrage, owner, schluessel) }
        }
    }

    /** Auch offline, wie TeileRepository.deletePart. */
    override suspend fun deleteMinifig(figNumber: String, owner: Int?): Ergebnis<GenericResponse> =
        schreibe(Bearbeitung.FigurLoeschen(figNumber, owner), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.deleteMinifig(figNumber, owner, schluessel) }
        }

    override suspend fun getMinifigStats(accounts: String?): Ergebnis<MinifigStatsResponse> =
        safeCall { api.getMinifigStats(accounts) }

    override suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String?): Ergebnis<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitFigur(figNumber, accounts) }
}
