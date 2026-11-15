package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.model.fach.LagerortAnsicht
import ch.brickinventoryapp.model.fach.LagerortEintragAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeilBestand
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.Teilschluessel
import ch.brickinventoryapp.model.fach.VerwendungAnsicht
import ch.brickinventoryapp.model.fach.VorratsOrtAnsicht
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
                       ersatzteile: Ersatzteilwahl = Ersatzteilwahl.ALLE): Flow<Lokal<TeilAnsicht>>

    fun beobachteManuelleTeile(suche: String? = null): Flow<Lokal<ManuellesTeilAnsicht>>

    /** Alle Seiten der Teile und die manuellen Teile in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereTeile(): Ergebnis<Unit>

    /** Nur die manuellen Teile — wo die übrigen aus der Kontosicht kommen. */
    suspend fun aktualisiereManuelleTeile(): Ergebnis<Unit>

    suspend fun getPartsStats(konten: Kontoauswahl? = null): Ergebnis<TeileKennzahlenAnsicht?>

    suspend fun getPartsFilterColors(konten: Kontoauswahl? = null): Ergebnis<List<FilterFarbeAnsicht>>

    suspend fun getPartsCategories(konten: Kontoauswahl? = null): Ergebnis<List<KategorieAnsicht>>

    /** Der Bestand je gefragtem Teil; was fehlt, hat keinen Eintrag. */
    suspend fun getOwnedParts(teile: List<Teilschluessel>,
                              konten: Kontoauswahl? = null): Ergebnis<Map<Teilschluessel, TeilBestand>>

    /** Der Ort, wie der Server ihn gespeichert hat; null heisst keiner. */
    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String): Ergebnis<String?>

    suspend fun getLagerorte(konten: Kontoauswahl? = null): Ergebnis<List<LagerortAnsicht>>

    /** Der eigene Vorrat an Lagerorten samt Vorgabe aus der Ablage; [aktualisiereLagerortVorrat] füllt ihn. */
    fun beobachteLagerortVorrat(): Flow<Lokal<VorratsOrtAnsicht>>

    suspend fun aktualisiereLagerortVorrat(): Ergebnis<Unit>

    /**
     * Der Vorrat anderer Besitzer — Vorschläge für das Set eines Unterkontos. Eine
     * Frage je Set, keine Liste des Kontos, deshalb nicht in der Ablage.
     */
    suspend fun getLagerortVorrat(besitzer: List<Int>): Ergebnis<List<LagerortEintragAnsicht>>

    suspend fun legeLagerortAn(name: String): Ergebnis<Unit>

    /** [alt]: der bisherige Name — er steht an Sets, Teilen und Figuren und heisst dort danach neu. */
    suspend fun benenneLagerortUm(id: Int, alt: String, name: String): Ergebnis<Unit>

    suspend fun loescheLagerort(id: Int): Ergebnis<Unit>

    suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<Unit>

    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               konten: Kontoauswahl? = null): Ergebnis<VerwendungAnsicht>

    suspend fun getBrickColors(): Ergebnis<List<FarbeAnsicht>>

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
