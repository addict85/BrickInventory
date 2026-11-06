package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.flow.Flow

/**
 * Teile: Bestand, manuell erfasste Teile, Farben, Lagerorte.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (TeileRepositoryImpl).
 */
interface TeileRepository {
    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null,
                         /**
                          * "0" ohne, "1" nur Ersatzteile, null alle — wie parts-spare in der
                          * Webapp.
                          */
                         spare: String? = null,
                         /** "1" nur in der Tabellenansicht — siehe TeileApi.getParts. */
                         withSets: String? = null,
                         /** Lagerort — eigener Parameter, nicht Teil der Suche. */
                         storage: String? = null): Ergebnis<PartsResponse>

    fun beobachteTeile(): Flow<Lokal<Part>>

    fun beobachteManuelleTeile(): Flow<Lokal<PartValuationItem>>

    suspend fun getPartsStats(accounts: String? = null): Ergebnis<PartsStatsResponse>

    suspend fun getPartsFilterColors(accounts: String? = null): Ergebnis<PartsFilterColorsResponse>

    suspend fun getPartsCategories(accounts: String? = null): Ergebnis<PartsCategoriesResponse>

    suspend fun getManualParts(accounts: String? = null, search: String? = null,
                               storage: String? = null): Ergebnis<ManualPartsResponse>

    suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String? = null): Ergebnis<BestandResponse>

    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<LagerortResponse>

    suspend fun getLagerorte(accounts: String? = null): Ergebnis<LagerorteResponse>

    suspend fun getLagerortVorrat(owner: String? = null): Ergebnis<LagerortVorratResponse>

    suspend fun legeLagerortAn(name: String): Ergebnis<LagerortEintragResponse>

    suspend fun benenneLagerortUm(id: Int, name: String): Ergebnis<LagerortEintragResponse>

    suspend fun loescheLagerort(id: Int): Ergebnis<LagerortResponse>

    suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<LagerortVorgabeResponse>

    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String? = null): Ergebnis<VerwendendeSetsResponse>

    suspend fun getBrickColors(): Ergebnis<BrickColorsResponse>

    suspend fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null,
                         storage: String? = null): Ergebnis<AddPartResponse>

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String? = null, farbHex: String? = null,
                             owner: Int? = null): Ergebnis<TeilFarbeResponse>
}
