package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
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
