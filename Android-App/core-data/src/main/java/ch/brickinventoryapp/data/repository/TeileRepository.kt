package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.TeileApi
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
                         storage: String? = null): Result<PartsResponse>

    fun beobachteTeile(): Flow<Lokal<Part>>

    fun beobachteManuelleTeile(): Flow<Lokal<PartValuationItem>>

    suspend fun getPartsStats(accounts: String? = null): Result<PartsStatsResponse>

    suspend fun getPartsFilterColors(accounts: String? = null): Result<PartsFilterColorsResponse>

    suspend fun getPartsCategories(accounts: String? = null): Result<PartsCategoriesResponse>

    suspend fun getManualParts(accounts: String? = null, search: String? = null,
                               storage: String? = null): Result<ManualPartsResponse>

    suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String? = null): Result<BestandResponse>

    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Result<LagerortResponse>

    suspend fun getLagerorte(accounts: String? = null): Result<LagerorteResponse>

    suspend fun getLagerortVorrat(owner: String? = null): Result<LagerortVorratResponse>

    suspend fun legeLagerortAn(name: String): Result<LagerortEintragResponse>

    suspend fun benenneLagerortUm(id: Int, name: String): Result<LagerortEintragResponse>

    suspend fun loescheLagerort(id: Int): Result<LagerortResponse>

    suspend fun setzeLagerortVorgabe(id: Int?): Result<LagerortVorgabeResponse>

    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String? = null): Result<VerwendendeSetsResponse>

    suspend fun getBrickColors(): Result<BrickColorsResponse>

    suspend fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null,
                         storage: String? = null): Result<AddPartResponse>

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null): Result<GenericResponse>

    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Result<GenericResponse>

    suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String? = null, farbHex: String? = null,
                             owner: Int? = null): Result<TeilFarbeResponse>
}
