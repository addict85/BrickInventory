package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.ColorView
import ch.brickinventoryapp.model.fach.FilterColorView
import ch.brickinventoryapp.model.fach.CategoryView
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.LocationEntryView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.PartInventory
import ch.brickinventoryapp.model.fach.PartsMetricsView
import ch.brickinventoryapp.model.fach.PartialKey
import ch.brickinventoryapp.model.fach.UsageView
import ch.brickinventoryapp.model.fach.StockLocationView
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Teile: Bestand, manuell erfasste Teile, Farben, Lagerorte.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (TeileRepositoryImpl).
 */
interface PartsRepository {
    /**
     * Die Teile aus der Ablage nach Suche, Farbe, Kategorie und Ersatzteilen; [refreshParts]
     * füllt sie. Konto, Lagerort und „In Sets“ rechnet nur der Server: Kontosicht.
     */
    fun observeParts(suche: String? = null, farbe: ColorPicker = ColorPicker.Alle, kategorie: Kategoriewahl = Kategoriewahl.Alle,
                       spareParts: Ersatzteilwahl = Ersatzteilwahl.ALLE): Flow<Local<TeilAnsicht>>

    fun observeManualParts(suche: String? = null): Flow<Local<ManualPartView>>

    /** Alle Seiten der Teile und die manuellen Teile in die Ablage; gezeigt wird die Ablage. */
    suspend fun refreshParts(): Ergebnis<Unit>

    /** Nur die manuellen Teile — wo die übrigen aus der Kontosicht kommen. */
    suspend fun refreshManualParts(): Ergebnis<Unit>

    suspend fun getPartsStats(konten: Kontoauswahl? = null): Ergebnis<PartsMetricsView?>

    suspend fun getPartsFilterColors(konten: Kontoauswahl? = null): Ergebnis<List<FilterColorView>>

    suspend fun getPartsCategories(konten: Kontoauswahl? = null): Ergebnis<List<CategoryView>>

    /** Der Bestand je gefragtem Teil; was fehlt, hat keinen Eintrag. */
    suspend fun getOwnedParts(teile: List<PartialKey>,
                              konten: Kontoauswahl? = null): Ergebnis<Map<PartialKey, PartInventory>>

    /** Der Ort, wie der Server ihn gespeichert hat; null heisst keiner. */
    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<String?>

    suspend fun getLocations(konten: Kontoauswahl? = null): Ergebnis<List<LocationView>>

    /** Der eigene Vorrat an Lagerorten samt Vorgabe aus der Ablage; [refreshLocationStock] füllt ihn. */
    fun observeLocationStock(): Flow<Local<StockLocationView>>

    suspend fun refreshLocationStock(): Ergebnis<Unit>

    /**
     * Der Vorrat anderer Besitzer — Vorschläge für das Set eines Unterkontos. Eine
     * Frage je Set, keine Liste des Kontos, deshalb nicht in der Ablage.
     */
    suspend fun getLocationStock(besitzer: List<Int>): Ergebnis<List<LocationEntryView>>

    suspend fun putLocationAn(name: String): Ergebnis<Unit>

    /** [alt]: der bisherige Name — er steht an Sets, Teilen und Figuren und heisst dort danach neu. */
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
