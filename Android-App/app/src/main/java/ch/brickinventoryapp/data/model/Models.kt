package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi

@Serializable
data class LoginRequest(val username: String, val password: String, val label: String = "Android App")
@Serializable
data class QrLoginRequest(val token: String)
@Serializable
data class CsvImportStatus(
    val success: Boolean = false,
    val status: String? = null,   // "running", "done", "cancelled"
    val total: Int? = null,
    val done: Int? = null,
    val current: String? = null,
    val ok: Int? = null,
    val warn: Int? = null,
    val err: Int? = null,
    val error: String? = null     // set when success=false
)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val token: String? = null,
    val user: User? = null,
    val error: String? = null
)

@Serializable
data class User(
    val id: Int,
    val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false
)

@Serializable
data class SetItem(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val theme: String? = null,
    val pieces: Int? = null,
    val minifigs: Int? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * ALLE erfassten Zustände — je einer bekommt auf der Kachel eine Plakette.
     *
     * `condition` oben ist ein Aggregat und liefert genau einen Wert
     * („gebraucht, sobald eine Erfassung gebraucht ist"). Wer ein Exemplar neu
     * und eines gebraucht gekauft hat, sah damit nur „Gebraucht" — obwohl die
     * Neu-Erfassung mit ihrem eigenen Preis in die Bewertung eingeht.
     *
     * Der Server entscheidet, was drinsteht (conditionsFromAcquisitions in
     * utils/handlers.ts); hier wird nichts nachgerechnet.
     */
    val conditions: List<String> = emptyList(),
    /**
     * Besitzer im Haushalt — nur gesetzt, wenn mehrere Konten im Blickfeld
     * sind. Im Einzelkonto stünde an jeder Kachel „gehört mir", und das ist
     * Rauschen; im Haushalt ist es die wichtigste Angabe der Kachel, denn ohne
     * sie verschiebt man das falsche Exemplar.
     */
    val owners: List<HouseholdMember> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    /** Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn). */
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<Instruction> = emptyList()
) {
    /**
     * Der Kaufpreis, der ANGEZEIGT wird — mengengewichtet (Nachtrag 76).
     *
     * Marcos Befund: „In der Android-App wird der Kaufpreis des gebrauchten
     * Sets angezeigt, in der Webapp der gewichtete Durchschnittspreis."
     *
     * `purchasePrice` ist nur der in die sets-Zeile GESPIEGELTE Wert der
     * neuesten Erfassung. Bei mehreren Käufen (2×7.41 gebraucht, 1×9.48 neu)
     * ist das nicht der Preis der Sammlung, sondern der des letzten Kaufs — und
     * er passt auch nicht zur Prozentangabe daneben, die gegen den
     * Durchschnitt rechnet.
     *
     * Die Webapp nutzt `avg_purchase_price` seit jeher (mit demselben Rückfall).
     * Der Server rechnet den Wert; beide Clients lesen jetzt DASSELBE Feld —
     * die Regel steht hier EINMAL statt in jeder Ansicht.
     */
    val anzeigeKaufpreis: Double?
        get() = avgPurchasePrice ?: purchasePrice
}

@Serializable
data class Instruction(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null
)

@Serializable
data class SetPriceResponse(
    val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    val currency: String = "",
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
)

@Serializable
data class SetDetailResponse(val success: Boolean, val set: SetItem? = null)

@Serializable
data class PriceHistoryPoint(
    @SerialName("recorded_at") val recordedAt: String = "",
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    /** Nur beim vorangestellten Kaufpreis gesetzt (Server: is_purchase_price). */
    @SerialName("is_purchase_price") val isPurchasePrice: Boolean = false,
)

/** Ein Punkt der fertigen Diagrammdaten des Servers (utils/chartData.ts). */
@Serializable
data class PriceChartPoint(val x: String = "", val y: Double = 0.0)

/**
 * Eine benannte Linie.
 *
 * `firstRealIndex` ist NICHT kosmetisch: Davor stehen mit 0 aufgefüllte
 * Positionen, damit alle Reihen dieselbe Länge haben. Wer sie zeichnet, erhält
 * eine Linie, die bei null beginnt und dann senkrecht hochspringt — ein
 * Kurssturz, den es nie gab. Der Schlüssel heisst im JSON bewusst camelCase:
 * er kommt aus einem TypeScript-Objektliteral, nicht aus der Datenbank.
 */
@Serializable
data class PriceChartSeries(
    val name: String = "",
    val values: List<PriceChartPoint> = emptyList(),
    @SerialName("firstRealIndex") val firstRealIndex: Int = 0,
)

/** Fertige Diagrammdaten mit gemeinsamer x-Achse. */
@Serializable
data class PriceChartData(
    val values: List<PriceChartSeries> = emptyList(),
    val x: List<String> = emptyList(),
)

/** Aktueller Preis eines Zustands aus price_cache. */
@Serializable
data class CurrentPrice(
    val condition: String = "",
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

/** Marktpreis und Entwicklung EINES Zustands (Server: by_condition). */
@Serializable
data class ConditionValuation(
    @SerialName("market_price") val marketPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: Double? = null,
)

/**
 * Zwei-Zustands-Container. Bewusst zwei benannte Felder statt einer Map:
 * Es gibt genau zwei Zustände, und `N`/`U` sind damit beim Lesen sichtbar.
 */
@Serializable
data class PriceByCondition(
    @SerialName("N") val new: ConditionValuation? = null,
    @SerialName("U") val used: ConditionValuation? = null,
) {
    /** Nur die Zustände, zu denen der Server eine Zeile geliefert hat. */
    fun present(): List<Pair<String, ConditionValuation>> = buildList {
        new?.let  { add("N" to it) }
        used?.let { add("U" to it) }
    }
}

@Serializable
data class CurrentByCondition(
    @SerialName("N") val new: CurrentPrice? = null,
    @SerialName("U") val used: CurrentPrice? = null,
)

/**
 * Antwort von /api/v1/sets/:setNumber/price-history.
 *
 * BRUCHÄNDERUNG ab Server hardened-89: Statt einer zusammengefalteten `history`
 * kommen beide Zustände GETRENNT (history_new/history_used), dazu fertige
 * Diagrammdaten (`chart`), die aktuellen Preise je Zustand (`current`) und
 * Marktpreis/Entwicklung je Zustand (`by_condition`).
 *
 * Die x-Achse rechnet damit der Server (utils/chartData.ts) — vorher tat das
 * jeder Client für sich, und genau solche Doppelungen sind in diesem Projekt
 * schon mehrfach auseinandergelaufen.
 */
@Serializable
data class PriceHistoryResponse(
    val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    val currency: String = "",
    /** Zustand des Bestandes ('N'/'U') — worauf sich pnl_pct bezieht. */
    val condition: String = "N",
    @SerialName("history_new")  val historyNew: List<PriceHistoryPoint> = emptyList(),
    @SerialName("history_used") val historyUsed: List<PriceHistoryPoint> = emptyList(),
    val current: CurrentByCondition = CurrentByCondition(),
    @SerialName("by_condition") val byCondition: PriceByCondition = PriceByCondition(),
    val chart: PriceChartData = PriceChartData(),
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
)

@Serializable
data class SetResponse(
    val success: Boolean,
    val set: SetItem? = null,
    val error: String? = null
)

@Serializable
data class SetsResponse(
    val success: Boolean,
    val count: Int = 0,
    val sets: List<SetItem> = emptyList(),
    /** Gesamtzahl über ALLE Seiten — nur bei seitenweisem Abruf gesetzt. */
    val total: Int = 0,
    /**
     * Themen des ganzen Bestands, nicht der geladenen Seite. Der Server
     * schickt sie nur mit der ERSTEN Seite; Folgeseiten sparen die Abfrage.
     */
    val themes: List<String> = emptyList(),
    val error: String? = null
)

@Serializable
data class AddSetRequest(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
)

@Serializable
data class AddSetResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val name: String? = null,
    val error: String? = null
)

@Serializable
data class UpdateManualItemRequest(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

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
data class PartValuationItem(
    val id: Int? = null,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = 0,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val note: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("display_value") val displayValue: String? = null,
    val condition: String? = null,
    /** Alle erfassten Zustände — je einer eine Plakette (siehe SetItem). */
    val conditions: List<String> = emptyList(),
    /** Besitzer im Haushalt — siehe SetItem.owners. */
    val owners: List<HouseholdMember> = emptyList(),
    /**
     * Eine Zeile je Kaufpreis — dieselbe Form wie bei Sets. Leer, solange
     * es keine Erfassungen gibt (Altbestand); dann bleibt es bei der
     * einen Zeile aus den Feldern oben.
     */
    val acquisitions: List<ValuationAcquisition> = emptyList()
)

@Serializable
data class PartsValuationResponse(
    val success: Boolean,
    val currency: String = "EUR",
    val parts: List<PartValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String = "0.00",
    val error: String? = null
)

@Serializable
data class FigValuationItem(
    val id: Int? = null,
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    // Wie bei Minifig: lokal abgelegtes Bild hat Vorrang vor der CDN-Adresse.
    // Der Server legt Minifiguren-Bilder seit der Erweiterung des img-dl-Laufs
    // unter /images/ ab und liefert sie über express.static.
    @SerialName("image_local") val imageLocal: String? = null,
    val note: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("display_value") val displayValue: String? = null,
    val condition: String? = null,
    /** Alle erfassten Zustände — je einer eine Plakette (siehe SetItem). */
    val conditions: List<String> = emptyList(),
    /** Besitzer im Haushalt — siehe SetItem.owners. */
    val owners: List<HouseholdMember> = emptyList(),
    /**
     * Eine Zeile je Kaufpreis — dieselbe Form wie bei Sets. Leer, solange
     * es keine Erfassungen gibt (Altbestand); dann bleibt es bei der
     * einen Zeile aus den Feldern oben.
     */
    val acquisitions: List<ValuationAcquisition> = emptyList()
)

@Serializable
data class FigsValuationResponse(
    val success: Boolean,
    val currency: String = "EUR",
    val figs: List<FigValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String = "0.00",
    val error: String? = null
)

@Serializable
data class PnlTotals(
    val purchase: String = "0.00",
    val current: String = "0.00",
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("sets_purchase") val setsPurchase: String? = null,
    @SerialName("parts_purchase") val partsPurchase: String? = null,
    @SerialName("figs_purchase") val figsPurchase: String? = null,
    /**
     * Gesamtwert des Portfolios — Sets + manuell erfasste Teile + Minifiguren.
     *
     * Kommt seit Nachtrag 145 vom Server. Vorher addierten Webapp und
     * Android-App je selbst `sets.totals.avg + parts.total_value +
     * figs.total_value`; die Regel „was zählt zum Gesamtwert" stand damit an
     * drei Stellen. Nullbar, damit ältere Serverstände weiterhin gehen — der
     * Aufrufer fällt dann auf die eigene Addition zurück.
     */
    @SerialName("grand_total") val grandTotal: String? = null
)

@Serializable
data class PnlResponse(
    val success: Boolean,
    val currency: String = "EUR",
    val totals: PnlTotals = PnlTotals(),
    val error: String? = null
)

@Serializable
// Der globale Json-Serializer nutzt encodeDefaults=true — ohne die
// EncodeDefault(NEVER)-Annotationen würde eine reine Mengenänderung
// zusätzlich "purchase_price": null und "condition": null senden. Auf dem
// Server löste "condition": null eine Coercion auf "N" aus (setzte den
// Zustand zurück) und ein mitgeschickter Kaufpreis überschrieb die soeben
// angelegte Erfassung. Beide Felder werden jetzt nur noch übertragen, wenn
// sie tatsächlich gesetzt sind.
@OptIn(ExperimentalSerializationApi::class)
data class UpdateQuantityRequest(
    val quantity: Int,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
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
    @SerialName("is_spare") val isSpare: String? = null  // can be 'f','false','0' or '1'
)
val Part.isSpareFlag: Boolean get() = isSpare == "1" || isSpare == "true" || isSpare == "t"

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
data class ValuationSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("added_at") val addedAt: String? = null,
    val name: String? = null,
    val year: Int? = null,
    val quantity: Int = 1,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("total_qty_avg") val totalQtyAvg: String? = null,
    // Marktpreis ist seit der Preisumstellung avg_price, nicht der
    // mengengewichtete Schnitt — total_avg ist die passende Summe dazu.
    @SerialName("total_avg") val totalAvg: String? = null,
    // Mengengewichteter Kaufpreis über die Erfassungen (Server berechnet ihn).
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("from_cache") val fromCache: Boolean = true,
    @SerialName("is_fallback") val isFallback: Boolean = false,
    @SerialName("condition_used") val conditionUsed: String? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
    /**
     * Eine Zeile je Kaufpreis-Erfassung, jede mit dem Marktpreis IHRES
     * Zustands. Leer, solange ein Set keine Erfassungen hat (Altbestand) —
     * dann gilt weiterhin nur die Set-Zeile.
     */
    val acquisitions: List<ValuationAcquisition> = emptyList(),
    /** true, sobald Erfassungen in beiden Zuständen vorliegen. */
    val mixed: Boolean = false,
    val error: String? = null
)

/**
 * Eine Erfassung in der Finanztabelle.
 *
 * Warum das nicht der Client rechnet: Vorher galt ein Set als gebraucht,
 * sobald EINE Erfassung gebraucht war — der Marktpreis für ALLE Exemplare kam
 * dann aus dem Gebraucht-Preis. Wer ein Exemplar neu und eines gebraucht
 * gekauft hat, sah damit für das neue Exemplar den falschen Wert. Der Server
 * bewertet jede Erfassung jetzt einzeln (utils/acquisitionValue.ts).
 */
@Serializable
data class ValuationAcquisition(
    val id: Int = 0,
    val condition: String = "N",
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    /** Eigentümer DIESER Zeile — im Haushalt können es mehrere sein. */
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

@Serializable
data class Totals(
    val min: String = "0.00",
    val avg: String = "0.00",
    val max: String = "0.00",
    @SerialName("qty_avg") val qtyAvg: String = "0.00"
)

@Serializable
data class ValuationResponse(
    val success: Boolean,
    val currency: String = "EUR",
    val condition: String = "N",
    val sets: List<ValuationSet> = emptyList(),
    val totals: Totals = Totals(),
    val error: String? = null
)

@Serializable
data class DashboardStats(
    @SerialName("total_sets") val totalSets: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("total_pieces") val totalPieces: Int = 0,
    @SerialName("total_instructions") val totalInstructions: Int = 0,
    @SerialName("total_parts") val totalParts: Int = 0,
    @SerialName("total_minifigs") val totalMinifigs: Int = 0,
)

@Serializable
data class StatsResponse(val success: Boolean, val stats: DashboardStats? = null)

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

/**
 * Kennzahlen des Minifiguren-Reiters — vom SERVER gezählt.
 *
 * Vorher rechnete der Schirm sie aus der geladenen Liste. Die ist aber
 * gefiltert (`source != "manual"`), also zählte die Kachel „manuell erfasst"
 * zwangsläufig immer 0, und Arten/Stückzahl liessen die manuellen Einträge
 * aus — die Webapp zählte sie mit. Zwei Apps, zwei Zahlen für dieselbe
 * Sammlung. Gezählt wird jetzt in utils/handlers.ts über dieselbe Gruppierung
 * wie die Liste selbst.
 */
/**
 * Antwort auf „gibt es dieses Set schon?" (GET /api/v1/sets/exists/:nummer).
 *
 * Vorher fragte die App `getSetDetail()` und las aus dem FEHLER, ob das Set
 * existiert — das vermischt „nicht vorhanden" mit „Server nicht erreichbar"
 * und zwang zu einer eigenen Auswertung im Client. Jetzt sagt es der Server
 * ausdrücklich, mit derselben Regel, die auch beim Erfassen greift
 * (utils/setAdd.ts).
 */
@Serializable
data class SetExistsResponse(
    val success: Boolean = false,
    val exists: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("is_self") val isSelf: Boolean = false
)

/**
 * Antwort auf „an welcher Stelle der Liste beginnt dieses Jahr?"
 * (GET /api/v1/catalog/year-offset) — die Rechnung hinter dem Schnell-Scroll.
 *
 * Der Katalog hat rund 25 000 Sets und wird seitenweise geliefert; wohin ein
 * Jahr gehört, weiss nur die Datenbank. `offset` ist die laufende Nummer des
 * ersten Sets dieses Jahres, `page` die Seite, auf der es liegt.
 */
@Serializable
data class CatalogYearOffsetResponse(
    val success: Boolean = false,
    val offset: Int = 0,
    val page: Int = 1,
    val total: Int = 0
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
data class BarcodeResponse(
    val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    val name: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    @SerialName("image_url")   val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val source: String? = null,
    val error: String? = null
)

@Serializable
data class ChartPoint(
    @SerialName("x_label") val xLabel: String = "",
    val value: Double = 0.0,
    @SerialName("y_frac") val yFrac: Double = 0.0
)

@Serializable
data class ChartYAxis(
    val label: String = "",
    val value: Double = 0.0,
    val frac: Double = 0.0
)

@Serializable
data class PortfolioHistoryResponse(
    val success: Boolean,
    val currency: String = "EUR",
    val period: String = "week",
    val points: List<ChartPoint> = emptyList(),
    @SerialName("y_axis") val yAxis: List<ChartYAxis> = emptyList(),
    @SerialName("period_change_pct") val periodChangePct: Double? = null,
    @SerialName("purchase_total") val purchaseTotal: String? = null
)

@Serializable
data class UserSettings(
    val currency: String = "EUR",
    @SerialName("price_condition") val priceCondition: String = "N",
    @SerialName("price_cache_ttl") val priceCacheTtl: String = "24",
    @SerialName("default_price_condition") val defaultPriceCondition: String = "N",
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("effective_condition") val effectiveCondition: String = "N", // resolved: user→global→'N'
    @SerialName("app_theme") val appTheme: String = "classic" // global vom Admin gewähltes Design
)

@Serializable
data class SettingsResponse(
    val success: Boolean,
    val settings: UserSettings = UserSettings(),
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


// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — verknüpfte Konten
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Eine Familie verwaltet die Sammlung je Kind in einem eigenen Konto; das
 * Hauptkonto sieht alles zusammen und darf verschieben.
 *
 * Entschieden wird das ausschliesslich auf dem Server (utils/household.ts):
 * Das Blickfeld, die Schreibrechte und die Regeln (eine Stufe, gleiche
 * Währung) stehen dort. Die App zeigt nur, was ankommt — eine zweite Fassung
 * derselben Regeln hier wäre genau die Doppelung, an der in diesem Projekt
 * schon mehrere Zahlen auseinandergelaufen sind.
 */
@Serializable
data class HouseholdMember(
    val id: Int = 0,
    val username: String = "",
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class HouseholdMembersResponse(
    val success: Boolean = false,
    val members: List<HouseholdMember> = emptyList(),
)

@Serializable
data class HouseholdStatusResponse(
    val success: Boolean = false,
    @SerialName("is_main") val isMain: Boolean = false,
    @SerialName("is_sub")  val isSub: Boolean = false,
    val currency: String = "",
    @SerialName("linked_to") val linkedTo: HouseholdMember? = null,
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember> = emptyList(),
    @SerialName("open_invites") val openInvites: Int = 0,
    val error: String? = null,
)

@Serializable
data class HouseholdInviteResponse(
    val success: Boolean = false,
    val code: String? = null,
    @SerialName("expires_in") val expiresIn: Int? = null,
    val error: String? = null,
)

@Serializable
data class MoveSetRequest(
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id")   val toUserId: Int,
    /** Leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen. */
    @SerialName("acquisition_ids") val acquisitionIds: List<Int>? = null,
)

@Serializable
data class MoveSetResponse(
    val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    val quantity: Int = 0,
    val acquisitions: Int = 0,
    /** true, wenn das Zielkonto das Set schon besass und zusammengefasst wurde. */
    val merged: Boolean = false,
    val parts: Int = 0,
    val minifigs: Int = 0,
    val instructions: Int = 0,
    /** true, wenn beim Absender das letzte Exemplar gegangen ist. */
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    val error: String? = null,
)

@Serializable
data class GenericResponse(
    val success: Boolean,
    val error: String? = null,
    /**
     * Neu berechnetes Zustands-Aggregat des Sets, wenn die Antwort von einem
     * Schreibvorgang auf set_acquisitions kommt.
     *
     * Der Server liefert es mit, damit der Client die Regel „eine U-Erfassung
     * macht das Set gebraucht" nicht nachbauen muss. Ohne das behielt die
     * Galerie-Kachel nach einer Zustandsänderung im Kaufpreis-Dialog das alte
     * Label, bis die Liste neu geladen wurde.
     */
    val set: SetAggregate? = null,
    /**
     * Was beim Verschieben eines Kaufpreises in ein anderes Konto mitgewandert
     * ist. Der Server liefert die Zahlen seit jeher mit (moveSetBetweenAccounts
     * in utils/setMove.ts) — die App las sie nur nie und zeigte deshalb in der
     * Erfolgsmeldung immer „0 Teile und 0 Minifiguren".
     *
     * Null bedeutet: Die Antwort kam nicht von einem Verschiebe-Vorgang.
     */
    val parts: Int? = null,
    val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    /**
     * Die Gesamtmenge des Blickfelds NACH einer Mengenänderung.
     *
     * Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf
     * das eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den
     * eigenen Exemplaren — fremde lassen sich nicht wegnehmen —, und dann ist
     * das Ergebnis eine ANDERE Zahl als die gesendete. Der Regler hatte seine
     * lokale Zahl aber schon hochgezählt und stünde bis zum nächsten Laden
     * daneben.
     *
     * Null bedeutet: Die Antwort kam nicht von einer Mengenänderung.
     */
    val quantity: Int? = null,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String = "",
    val condition: String? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    // Ohne diese beiden Felder verlöre die Kachel nach dem Speichern die
    // zweite Plakette und den gewichteten Kaufpreis bis zum nächsten
    // vollständigen Laden — genau der Grund, aus dem es das Aggregat gibt.
    val conditions: List<String> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null
)

@Serializable
data class MeResponse(
    val success: Boolean,
    val user: User? = null
)

@Serializable
data class RateLimit(val count: Int = 0, val limit: Int = 0, val remaining: Int = 0)

@Serializable
data class CacheStatsResponse(
    val success: Boolean,
    val prices: Int = 0,
    val subsets: Int = 0,
    val catalog: Int = 0,
    @SerialName("price_stale") val priceStale: Int = 0,
    @SerialName("rate_limits") val rateLimits: RateLimits? = null
)

@Serializable
data class RateLimits(
    val bricklink: RateLimit = RateLimit(),
    val rebrickable: RateLimit = RateLimit(),
    val brickset: RateLimit = RateLimit()
)

@Serializable
data class ApiLimits(val rebrickable: Int = 0, val bricklink: Int = 0, val brickset: Int = 0)

@Serializable
data class ApiLimitsResponse(val success: Boolean, val limits: ApiLimits = ApiLimits())

@Serializable
data class CacheTtlResponse(val success: Boolean, val ttl: String = "24")

@Serializable
data class DefaultConditionResponse(val success: Boolean, val condition: String = "N")

@Serializable
data class DeleteWithQuantityResponse(
    val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0
)

@Serializable
data class Acquisition(
    val id: Int,
    val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null, // for parts/figs
    val condition: String = "N", // "N" = Neu, "U" = Gebraucht
    @SerialName("created_at") val createdAt: String? = null,
    /**
     * Eigentümer DIESER Zeile — im Haushalt können die Kaufpreise eines Sets
     * mehreren Konten gehören. Ohne das Feld wüsste die Eigentümer-Auswahl
     * nicht, worauf sie steht, und ein Wechsel griffe die falsche Zeile ab.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
) {
    // Effective price: whichever field is set (sets use purchase_price, parts/figs use unit_price)
    val effectivePrice: Double? get() = purchasePrice ?: unitPrice
}

/**
 * Summenzeile einer Erfassungsliste — vom SERVER gerechnet.
 *
 * Die Rechnung stand vorher viermal in den Oberflächen (zweimal hier, zweimal
 * in der Webapp) und war sich nicht einmal einig, aus welchem Feld der Preis
 * kommt. Jetzt liegt sie in utils/acquisitions.ts (`acquisitionTotals`), und
 * beide Clients zeigen dasselbe an.
 *
 * `amount = null` heisst „kein Kaufpreis erfasst" — nicht „null Franken".
 * Genau deshalb entscheidet der Server das und nicht die Ansicht.
 */
@Serializable
data class AcquisitionTotals(
    val quantity: Int = 0,
    val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Int = 0
)

@Serializable
data class AcquisitionsResponse(
    val success: Boolean,
    val acquisitions: List<Acquisition> = emptyList(),
    /**
     * Vorgabe für ältere Serverstände: leere Summe. Die Ansichten zeigen dann
     * „×0" und einen Gedankenstrich statt einer selbst gerechneten Zahl —
     * lieber sichtbar leer als still abweichend.
     */
    val totals: AcquisitionTotals = AcquisitionTotals()
)

@Serializable
data class UpdateAcquisitionRequest(
    /**
     * Der Kaufpreis EINER Erfassungszeile — bei SETS.
     *
     * ── Zwei Feldnamen, kein Versehen des Servers (Nachtrag 111) ────────────
     *
     * Marcos Befund: „Wenn ich in der Android-App den Kaufpreis anpasse, wird
     * er nicht gespeichert."
     *
     * Der Server liest das Preisfeld unter dem Namen der jeweiligen Spalte
     * (`req.body[cfg.priceCol]`):
     *
     *     Sets                    → purchase_price
     *     Teile und Minifiguren   → unit_price
     *
     * Das ist konsequent: Bei einem Set ist es der Preis des Sets, bei Teilen
     * und Minifiguren der Preis JE STÜCK. Die Webapp bedient beide Namen seit
     * jeher; die App schickte immer `purchase_price`. Für Teile und
     * Minifiguren fand der Server also kein Preisfeld — und liess den Preis
     * unverändert, ohne Fehler zu melden.
     *
     * Beide Felder sind nullbar und werden bei `null` nicht mitgeschickt
     * (kotlinx.serialization lässt Vorgabewerte weg). Es wird also immer genau
     * eines gesetzt — siehe `fuerSet()` und `fuerStueck()` unten.
     */
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    /** Der Kaufpreis je Stück — bei TEILEN und MINIFIGUREN. Siehe oben. */
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: String? = null,
    val quantity: Int? = null,
    val date: String? = null,
    /**
     * Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile.
     *
     * Der Server behandelt das Feld VOR allen anderen und beendet die Anfrage
     * damit: Preis oder Datum derselben Zeile im selben Aufruf zu ändern
     * hiesse, sie zweimal zu suchen — einmal beim Absender, einmal beim
     * Empfänger, wo sie womöglich schon mit einer Tageszeile verschmolzen ist.
     *
     * Der ABSENDER wird nicht mitgeschickt: Die Erfassungs-ID ist eindeutig,
     * und wem die Zeile gehört, ermittelt der Server aus der Zeile selbst
     * (acquisitionMoveSource). Ein Client kann die Frage damit nicht mehr
     * falsch beantworten — genau daran ist der Wechsel in der Webapp
     * gescheitert. MoveSetRequest behält from_user_id: Dort geht es um
     * mehrere Zeilen auf einmal, und der Absender ist Teil der Auswahl.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
) {
    companion object {
        /** Für Set-Erfassungen: Preis geht als `purchase_price`. */
        fun fuerSet(
            preis: Double? = null, condition: String? = null, quantity: Int? = null,
            date: String? = null, ownerUserId: Int? = null,
        ) = UpdateAcquisitionRequest(
            purchasePrice = preis, condition = condition, quantity = quantity,
            date = date, ownerUserId = ownerUserId)

        /** Für Teile und Minifiguren: Preis geht als `unit_price`. */
        fun fuerStueck(
            preis: Double? = null, condition: String? = null, quantity: Int? = null,
            date: String? = null, ownerUserId: Int? = null,
        ) = UpdateAcquisitionRequest(
            unitPrice = preis, condition = condition, quantity = quantity,
            date = date, ownerUserId = ownerUserId)
    }
}

// ── Monitoring models ─────────────────────────────────────────────────────────
@Serializable
data class JobStatus(
    val label: String = "",
    val status: String = "idle",
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null
)

@Serializable
data class JobsResponse(val success: Boolean, val jobs: Map<String, JobStatus> = emptyMap())

@Serializable
data class BricksetQueueEntry(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val attempts: Int = 0,
    @SerialName("retry_after") val retryAfter: String? = null,
    @SerialName("last_error") val lastError: String? = null
)

@Serializable
data class BricksetQueueResponse(
    val success: Boolean,
    val count: Int = 0,
    val entries: List<BricksetQueueEntry> = emptyList()
)

@Serializable
data class GenericAdminResponse(val success: Boolean, val error: String? = null, val enqueued: Int = 0)

// ── Katalog (Rebrickable-Set-Katalog, /api/v1/catalog/*) ─────────────────────

@Serializable
data class CatalogTheme(
    val id: Int,
    val name: String,
    @SerialName("set_count") val setCount: Int = 0
)

@Serializable
data class CatalogYearCount(
    val year: Int,
    val n: Int = 0
)

@Serializable
data class CatalogMetaResponse(
    val success: Boolean,
    val themes: List<CatalogTheme> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount> = emptyList(),
    val error: String? = null
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    // Vom Server ermittelt: existiert bereits eine lokale Kopie unter
    // public/images/sets/<setnummer>.jpg? Nutzerunabhängig — irgendein Nutzer
    // hat dieses Set eventuell schon einmal seinem Bestand hinzugefügt.
    @SerialName("image_local") val imageLocal: String? = null,
    val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0
)

@Serializable
data class CatalogSetsResponse(
    val success: Boolean,
    val total: Int = 0,
    val page: Int = 1,
    val pages: Int = 1,
    val sets: List<CatalogSetItem> = emptyList(),
    val error: String? = null
)

/**
 * BrickLink-Verweis, fertig vom Server aufgelöst (utils/bricklinkLink.ts).
 *
 * Die URL wird bewusst NICHT mehr im Client gebaut: ob eine Rebrickable-Nummer
 * auf BrickLink ein Set, Gear oder ein Buch ist, weiss nur der Server über
 * catalog_cache — und die Regel darf nicht in Webapp und App doppelt liegen.
 * url ist null, wenn der Artikel dort gar nicht gelistet ist.
 */
@Serializable
data class BrickLinkRef(
    val type: String = "SET",
    val number: String = "",
    /**
     * Ziel-URL, immer gesetzt. Ist der Artikel nicht eindeutig bestimmbar,
     * zeigt sie auf die BrickLink-Suche statt auf eine Katalogseite.
     */
    val url: String? = null,
    /** true = direkte Katalogseite, false = Suchtrefferliste */
    val exact: Boolean = true,
    val resolved: Boolean = false
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val minifigs: Int = 0,
    val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
    val bricklink: BrickLinkRef? = null
)

@Serializable
data class CatalogSetDetailResponse(
    val success: Boolean,
    val set: CatalogSetDetail? = null,
    val error: String? = null
)
