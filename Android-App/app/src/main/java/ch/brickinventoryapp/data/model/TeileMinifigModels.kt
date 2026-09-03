package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Teile, Minifiguren und Farben.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

@Serializable
data class AddPartRequest(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = 0,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    val note: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
)

@Serializable
data class AddPartResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    val error: String? = null
)

@Serializable
data class AddMinifigRequest(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val quantity: Int = 1,
    val note: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
)

@Serializable
data class AddMinifigResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    val error: String? = null
)

@Serializable
data class Part(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = 0,
    @SerialName("bl_color_id") val blColorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("in_sets") val inSets: String? = null,
    /**
     * Ersatzteil? Ein echter Wahrheitswert.
     *
     * Stand hier als String? mit dem Vermerk „can be 'f','false','0' or '1'"
     * — und daneben ein Helfer isSpareFlag, der das deutete. Beides ist weg:
     * Der Server liest die Schreibweisen jetzt an EINER Stelle
     * (istErsatzteil() in utils/validate.ts) und liefert true/false.
     *
     * Der Helfer war ausserdem gefaehrlich nah an einem Fehler: "0" ist in
     * JavaScript wahr, und die Webapp haette mit einem naiven Test JEDES Teil
     * als Ersatzteil markiert.
     */
    @SerialName("is_spare") val isSpare: Boolean = false
)

@Serializable
data class PartsResponse(
    val success: Boolean,
    val total: Int = 0,
    val page: Int = 1,
    @SerialName("page_size") val pageSize: Int = 100,
    val parts: List<Part> = emptyList(),
    val error: String? = null
)

@Serializable
data class PartsStats(
    @SerialName("unique_combinations") val uniqueCombinations: Int = 0,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("unique_colors") val uniqueColors: Int = 0,
    @SerialName("unique_categories") val uniqueCategories: Int = 0,
    @SerialName("total_parts") val totalParts: Int = 0
)

@Serializable
data class PartsStatsResponse(val success: Boolean, val stats: PartsStats? = null)

@Serializable
data class Minifig(
    @SerialName("fig_number") val figNumber: String,
    val condition: String? = null,
    /** Alle erfassten Zustände — je einer eine Plakette (siehe SetItem). */
    val conditions: List<String> = emptyList(),
    /** Besitzer im Haushalt — siehe SetItem.owners. */
    val owners: List<HouseholdMember> = emptyList(),
    /** Mengengewichteter Kaufpreis über die Erfassungen. */
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("fig_name")   val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("total_quantity") val totalQuantity: Int? = null,
    @SerialName("image_url")  val imageUrl: String? = null,
    // Lokal abgelegtes Bild auf dem Server. Der Hintergrundlauf img-dl legt
    // Minifiguren-Bilder inzwischen wie Set-Bilder unter /images/ ab; von dort
    // kommen sie über express.static statt über das CDN. Fehlt der Wert (noch
    // nicht geladen), greift imageUrl.
    @SerialName("image_local") val imageLocal: String? = null,
    val source: String = "set",
    @SerialName("set_added_at") val setAddedAt: String? = null
)

@Serializable
data class MinifigStats(
    val types: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    val manual: Int = 0
)

@Serializable
data class MinifigStatsResponse(
    val success: Boolean = false,
    val stats: MinifigStats = MinifigStats()
)

@Serializable
data class MinifigsResponse(
    val success: Boolean,
    val figs: List<Minifig> = emptyList(),
    val error: String? = null
)

@Serializable
data class BrickColor(
    val id: Int,
    val name: String,
    val hex: String? = null
)

@Serializable
data class BrickColorsResponse(
    val success: Boolean,
    val colors: List<BrickColor> = emptyList(),
    val error: String? = null
)

@Serializable
data class DefaultConditionResponse(val success: Boolean, val condition: String = "N")

// ── Detail-Dialog fuer Teile und Figuren AUS SETS ───────────────────────────
//
// Marcos Wunsch: „Auch die automatisch erfassten Teile und Minifiguren sollen
// einen Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden,
// die Anzahl soll nicht geaendert werden koennen. Dafuer soll angezeigt werden,
// welche Sets dieses Teil und Minifigur verwenden."
//
// EIN Modellpaar fuer beide Faelle: Der Server beantwortet die Frage mit
// derselben Funktion (verwendendeSets in utils/handlers/shared.ts) und liefert
// deshalb dieselbe Form. Figuren haben keine Farbe und keine Kategorie — die
// Felder stehen dort als null, nicht als eigene Antwortform. Zwei Formen
// unterscheiden zu muessen ist genau die Sorte Doppelung, an der hier schon
// mehrfach etwas auseinandergelaufen ist.

/** Ein Set, in dem dieses Teil / diese Figur steckt. */
@Serializable
data class VerwendendesSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("set_name") val setName: String? = null,
    val quantity: Int = 0,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
)

/** Das Teil bzw. die Figur selbst — die Kopfzeile des Dialogs. */
@Serializable
data class BestandteilKopf(
    val nummer: String,
    val name: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("is_spare") val isSpare: Boolean = false,
    /** Summe ueber ALLE Sets im Blickfeld. */
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class VerwendendeSetsResponse(
    val success: Boolean = false,
    val item: BestandteilKopf? = null,
    val sets: List<VerwendendesSet> = emptyList(),
    val error: String? = null,
)
