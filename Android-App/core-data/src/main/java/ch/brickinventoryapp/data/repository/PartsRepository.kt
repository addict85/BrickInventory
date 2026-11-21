package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Erfasst
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.StockLocationView
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Parts: stock, manually added parts, colors, storage locations.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (TeileRepositoryImpl).
 */
interface PartsRepository {
    /**
     * The parts from the store by search, color, category and spare parts; [refreshParts]
     * fills them. Account, storage location and „In Sets“ are computed only by the server: Kontosicht.
     */
    fun observeParts(suche: String? = null, farbe: ColorPicker = ColorPicker.Alle, kategorie: Kategoriewahl = Kategoriewahl.Alle,
                       spareParts: Ersatzteilwahl = Ersatzteilwahl.ALLE): Flow<Local<TeilAnsicht>>

    fun observeManualParts(suche: String? = null): Flow<Local<ManualPartView>>

    /** All pages of the parts and the manual parts into the store; the store is shown. */
    suspend fun refreshParts(): Ergebnis<Unit>

    /** Only the manual parts — where the others come from the Kontosicht. */
    suspend fun refreshManualParts(): Ergebnis<Unit>

    suspend fun getPartsStats(konten: Kontoauswahl? = null): Ergebnis<PartsMetricsView?>

    suspend fun getPartsFilterColors(konten: Kontoauswahl? = null): Ergebnis<List<FilterColorView>>

    suspend fun getPartsCategories(konten: Kontoauswahl? = null): Ergebnis<List<CategoryView>>

    /** Der Bestand je gefragtem Teil; was fehlt, hat keinen Eintrag. */
    suspend fun getOwnedParts(teile: List<PartialKey>,
                              konten: Kontoauswahl? = null): Ergebnis<Map<PartialKey, PartInventory>>

    /** The location as the server saved it; null means none. */
    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<String?>

    suspend fun getLocations(konten: Kontoauswahl? = null): Ergebnis<List<LocationView>>

    /** The own supply of storage locations including default from the store; [refreshLocationStock] fills it. */
    fun observeLocationStock(): Flow<Local<StockLocationView>>

    suspend fun refreshLocationStock(): Ergebnis<Unit>

    /**
     * The supply of other owners — suggestions for the set of a sub-account. A
     * question per set, not a list of the account, hence not in the store.
     */
    suspend fun getLocationStock(besitzer: List<Int>): Ergebnis<List<LocationEntryView>>

    suspend fun putLocationAn(name: String): Ergebnis<Unit>

    /** [alt]: the previous name — it stands on sets, parts and figures and gets the new name there afterwards. */
    suspend fun nameLocationUm(id: Int, alt: String, name: String): Ergebnis<Unit>

    suspend fun deleteLocation(id: Int): Ergebnis<Unit>

    suspend fun setLocationDefault(id: Int?): Ergebnis<Unit>

    suspend fun getSetsWithPart(partNumber: String, colorId: Int,
                               konten: Kontoauswahl? = null): Ergebnis<UsageView>

    suspend fun getBrickColors(): Ergebnis<List<ColorView>>

    suspend fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Geld? = null,
                         condition: Zustand? = null, ownerUserId: Int? = null,
                         storage: String? = null): Ergebnis<Erfasst>

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Zustand? = null, owner: Int? = null): Ergebnis<Unit>

    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Ergebnis<Unit>

    suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String? = null, farbHex: String? = null,
                             owner: Int? = null): Ergebnis<Unit>
}
