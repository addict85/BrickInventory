package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.*
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Teile: Bestand, manuell erfasste Teile, Farben, Lagerorte.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (TeileRepositoryImpl).
 */
interface TeileRepository {
    /**
     * Die Teile aus der Ablage nach Suche, Farbe, Kategorie und Ersatzteilen; [aktualisiereTeile]
     * füllt sie. Konto, Lagerort und „In Sets“ rechnet nur der Server: Kontosicht.
     */
    fun beobachteTeile(suche: String? = null, farbe: String? = null, kategorie: String? = null,
                       ersatzteile: Ersatzteilwahl = Ersatzteilwahl.ALLE): Flow<Lokal<Part>>

    fun beobachteManuelleTeile(suche: String? = null): Flow<Lokal<PartValuationItem>>

    /** Alle Seiten der Teile und die manuellen Teile in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereTeile(): Ergebnis<Unit>

    /** Nur die manuellen Teile — wo die übrigen aus der Kontosicht kommen. */
    suspend fun aktualisiereManuelleTeile(): Ergebnis<Unit>

    suspend fun getPartsStats(accounts: String? = null): Ergebnis<PartsStatsResponse>

    suspend fun getPartsFilterColors(accounts: String? = null): Ergebnis<PartsFilterColorsResponse>

    suspend fun getPartsCategories(accounts: String? = null): Ergebnis<PartsCategoriesResponse>

    suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String? = null): Ergebnis<BestandResponse>

    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<LagerortResponse>

    suspend fun getLagerorte(accounts: String? = null): Ergebnis<LagerorteResponse>

    suspend fun getLagerortVorrat(owner: String? = null): Ergebnis<LagerortVorratResponse>

    suspend fun legeLagerortAn(name: String): Ergebnis<LagerortEintragResponse>

    /** [alt]: der bisherige Name — er steht an Sets, Teilen und Figuren und heisst dort danach neu. */
    suspend fun benenneLagerortUm(id: Int, alt: String, name: String): Ergebnis<LagerortEintragResponse>

    suspend fun loescheLagerort(id: Int): Ergebnis<LagerortResponse>

    suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<LagerortVorgabeResponse>

    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String? = null): Ergebnis<VerwendendeSetsResponse>

    suspend fun getBrickColors(): Ergebnis<BrickColorsResponse>

    suspend fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Double? = null,
                         condition: Zustand? = null, ownerUserId: Int? = null,
                         storage: String? = null): Ergebnis<AddPartResponse>

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Zustand? = null, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Ergebnis<GenericResponse>

    suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String? = null, farbHex: String? = null,
                             owner: Int? = null): Ergebnis<TeilFarbeResponse>
}
