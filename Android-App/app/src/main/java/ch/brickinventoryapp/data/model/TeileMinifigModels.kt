package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Teile, Minifiguren und Farben. Die Modelle liegen je Sachgebiet in einer Datei,
 * alle im Paket data.model.
 */

/**
 * „Keine Farbe“ wie bei Rebrickable ([No Color/Any Color]) und auf dem Server
 * (utils/validate.ts). 0 ist Schwarz: Wer 0 für „keine“ schickt, macht aus
 * einem Teil ohne Farbangabe ein schwarzes.
 */
const val KEINE_FARBE = 9999

@Serializable
data class AddPartRequest(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = KEINE_FARBE,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    /**
     * Lagerort beim Erfassen; null heisst „nicht erfasst“. Der Server schreibt ihn
     * über dieselbe Stelle wie der Detaildialog (utils/lagerort.ts), ein neuer Ort
     * landet damit auch im Vorrat.
     */
    val storage: String? = null,
)

@Serializable
data class AddPartResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    /**
     * Aus welchem Zustand der übernommene Marktpreis stammt ('N'/'U'); null, wenn aus
     * dem angefragten oder von Hand eingetippt. BrickLink führt oft nur einen Zustand,
     * der Server nimmt dann den anderen, und die Oberfläche schreibt dazu, woher er
     * kommt (wie preisHerkunftHinweis() in der Webapp).
     */
    @SerialName("price_from_condition") val priceFromCondition: String? = null,
    val error: String? = null
)

@Serializable
data class AddMinifigRequest(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    /**
     * Lagerort beim Erfassen; null heisst „nicht erfasst“. Der Server schreibt ihn
     * über dieselbe Stelle wie der Detaildialog (utils/lagerort.ts), ein neuer Ort
     * landet damit auch im Vorrat.
     */
    val storage: String? = null,
)

@Serializable
data class AddMinifigResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    /**
     * Aus welchem Zustand der übernommene Marktpreis stammt ('N'/'U'); null, wenn aus
     * dem angefragten oder von Hand eingetippt. BrickLink führt oft nur einen Zustand,
     * der Server nimmt dann den anderen, und die Oberfläche schreibt dazu, woher er
     * kommt (wie preisHerkunftHinweis() in der Webapp).
     */
    @SerialName("price_from_condition") val priceFromCondition: String? = null,
    val error: String? = null
)

@Serializable
data class Part(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = KEINE_FARBE,
    @SerialName("bl_color_id") val blColorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("in_sets") val inSets: String? = null,
    /**
     * Ersatzteil? Ein echter Wahrheitswert: Der Server deutet die Schreibweisen an
     * einer Stelle (istErsatzteil() in utils/validate.ts) — eine zweite Deutung hier
     * könnte "0" anders lesen.
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
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("unique_colors") val uniqueColors: Int = 0,
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
    val owners: List<KontoName> = emptyList(),
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

/**
 * Ein Eintrag der Filterliste „Farbe“: die Farben im Bestand mit Anzahl
 * (/parts/colors, wie in der Webapp). Nicht [BrickColor], der Farbkatalog für die
 * Auswahl beim Erfassen.
 */
@Serializable
data class PartsFilterColor(
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsFilterColorsResponse(
    val success: Boolean = false,
    val colors: List<PartsFilterColor> = emptyList(),
)

/**
 * Ein Eintrag der Filterliste „Kategorie“. `categoryName` ist der Wert, den der
 * Server als Filter erwartet (meist eine Kategorie-ID als Text), `label` der Name
 * zum Anzeigen.
 */
@Serializable
data class PartsCategory(
    @SerialName("category_name") val categoryName: String? = null,
    val label: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsCategoriesResponse(
    val success: Boolean = false,
    val categories: List<PartsCategory> = emptyList(),
)

@Serializable
data class DefaultConditionResponse(val success: Boolean, val condition: String = "N")

// ── Detail-Dialog für Teile und Figuren aus Sets ──
//
// Ein Modellpaar für beide: Der Server antwortet mit derselben Funktion
// (verwendendeSets); bei Figuren stehen Farbe und Kategorie als null statt in
// einer zweiten Form.

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
    /**
     * Lagerort, verdichtet über alle Zeilen dieses Teils — es kann in mehreren Kisten
     * liegen. Figuren führen null; ihr Ort steht im Set-Detail.
     */
    val storage: String? = null,
    /**
     * Wem dieses Teil gehört — für die Lagerort-Auswahl im Dialog: Beim Set des Enkels
     * stehen dessen Regale zur Wahl. Mehrere, weil dasselbe Teil in Sets verschiedener
     * Konten stecken kann.
     */
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
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

// ═══ „Kann ich das bauen?“ — der eigene Bestand zu einer Teileliste ═══
//
// POST, obwohl nichts geändert wird: Über tausend Teil-Farb-Paare ergäben eine
// Adresse, die kein Proxy durchlässt. Der Kontofilter reist als `accounts=` mit,
// weil er zur Ansicht gehört.

/** Ein angefragtes Teil-Farb-Paar in der REBRICKABLE-Schreibweise. */
@Serializable
data class BestandTeil(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id")    val colorId: Int,
)

@Serializable
data class BestandRequest(val teile: List<BestandTeil>)

/**
 * Zwei Zahlen je Teil-Farb-Paar: `gesamt` alles im Blickfeld, `lose` nur, was
 * nicht in einem Set steckt — für ein Teil im aufgebauten Set müsste man ein
 * anderes zerlegen. Welche gilt, entscheidet der Mensch.
 */
@Serializable
data class BestandEintrag(
    val gesamt: Int = 0,
    val lose: Int = 0,
)

@Serializable
data class BestandResponse(
    val success: Boolean = false,
    /** Schluessel: "<partNumber>|<colorId>". */
    val bestand: Map<String, BestandEintrag> = emptyMap(),
    val error: String? = null,
)

// ═══════════════════════════════════════════════════════════════════════════
// Farbe eines manuell erfassten Teils nachtraeglich aendern
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Die Farbe eines Teils nachträglich ändern. `colorName` und `colorHex` reisen
 * mit, weil die Teileliste den Namen aus der Zeile liest; der Server holt sie aus
 * rb_colors, wenn sie fehlen (utils/teilFarbeAendern.ts).
 */
@Serializable
data class TeilFarbeRequest(
    @SerialName("color_id")   val colorId: Int,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex")  val colorHex: String? = null,
)

/**
 * Was die Farbänderung getan hat. `zusammengelegt`: Das Teil stand schon in der
 * richtigen Farbe da; die Zielzeile bleibt, die falsche geht.
 */
@Serializable
data class TeilFarbeResponse(
    val success: Boolean = false,
    val zusammengelegt: Boolean = false,
    val verschoben: Int = 0,
    val vereint: Int = 0,
    val error: String? = null,
)

// ═══════════════════════════════════════════════════════════════════════════
// Lagerort — wo liegt das eigentlich?
// ═══════════════════════════════════════════════════════════════════════════

/** Leerer Text loescht den Ort — der Server macht daraus NULL. */
@Serializable
data class LagerortRequest(val storage: String)

@Serializable
data class LagerortResponse(
    val success: Boolean = false,
    val storage: String? = null,
    val changed: Int = 0,
    val error: String? = null,
)

/**
 * Ein belegter Lagerort mit Anzahl — nach Zeilen, nicht nach Stückzahl: „4 Sets
 * und 120 Teilesorten“ beantwortet, ob sich Nachsehen lohnt.
 */
@Serializable
data class Lagerort(
    val ort: String,
    val sets: Int = 0,
    val teile: Int = 0,
)

@Serializable
data class LagerorteResponse(
    val success: Boolean = false,
    val orte: List<Lagerort> = emptyList(),
    val error: String? = null,
)

/**
 * Ein Eintrag im Vorrat — was zur Wahl steht, auch leer. Nicht [Lagerort], der
 * belegte Ort für den Filter. Mit `userId`, weil eine Liste über mehrere Konten
 * spannen kann.
 */
@Serializable
data class LagerortEintrag(
    val id: Int = 0,
    @SerialName("user_id") val userId: Int = 0,
    val name: String = "",
)

@Serializable
data class LagerortVorratResponse(
    val success: Boolean = false,
    val orte: List<LagerortEintrag> = emptyList(),
    /**
     * Der beim Erfassen vorausgewählte Ort (der Stern). Mit dem Vorrat statt aus einem
     * eigenen Abruf, damit sich die beiden nicht überholen. null: keine Vorgabe; sie
     * ist immer die eigene.
     */
    val vorgabe: LagerortEintrag? = null,
    val error: String? = null,
)

@Serializable
data class LagerortNameRequest(val name: String)

/**
 * Den Stern setzen oder abschalten; `null` schaltet ab — der zweite Druck auf
 * denselben Stern.
 */
@Serializable
data class LagerortVorgabeRequest(val id: Int? = null)

/**
 * Die Antwort darauf. Eigener Bauplan, weil das Feld `vorgabe` heisst: Es sagt,
 * was jetzt die Vorgabe ist (`null` nach dem Abschalten). Ein Bauplan mit falschem
 * Feldnamen läse still `null`.
 */
@Serializable
data class LagerortVorgabeResponse(
    val success: Boolean = false,
    val vorgabe: LagerortEintrag? = null,
    val error: String? = null,
)

@Serializable
data class LagerortEintragResponse(
    val success: Boolean = false,
    val ort: LagerortEintrag? = null,
    val error: String? = null,
)
