package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogThemeView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.InstructionView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.WantedItemAlarmView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired
import ch.brickinventoryapp.model.util.parseInstant
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/*
 * The store form of every compartment, version 1. The field names are frozen to what
 * was formerly stored as server model: older rows stay readable, and a
 * change to the domain type changes only the mapping here, not the disk.
 */

@Serializable
internal data class SetRow(
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
    val condition: Condition? = null,
    val storage: String? = null,
    val conditions: List<Condition> = emptyList(),
    val owners: List<AccountRow> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<InstructionRow> = emptyList(),
    val bricklink: BrickLinkRow? = null,
    @SerialName("preisvergleich_url") val priceComparisonUrl: String? = null,
)

@Serializable
internal data class AccountRow(val id: Int = 0, val username: String = "")

@Serializable
internal data class InstructionRow(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    @SerialName("is_manual") val isManual: Boolean = false,
)

@Serializable
internal data class BrickLinkRow(
    val type: String = "SET",
    val number: String = "",
    val url: String? = null,
    val exact: Boolean = true,
    val resolved: Boolean = false,
)

@Serializable
internal data class RememberRow(
    @SerialName("set_number") val setNumber: String = "",
    val condition: Condition = Condition.NEW,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("marktpreis") val marketPrice: Double? = null,
    @SerialName("waehrung") val currency: CurrencyCode = CurrencyCode.EUR,
    val owned: Boolean = false,
    val alarm: RememberAlarmRow? = null,
    @SerialName("preisvergleich_url") val priceComparisonUrl: String? = null,
)

@Serializable
internal data class RememberAlarmRow(
    @SerialName("richtung") val direction: AlarmDirection = AlarmDirection.BELOW,
    @SerialName("schwelle") val threshold: Double = 0.0,
    @SerialName("ausgeloest") val triggered: Boolean = false,
)

@Serializable
internal data class PartRow(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("bl_color_id") val blColorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("is_spare") val isSpare: Boolean = false,
)

/** A place in the supply; [default] marks the star the server sends next to the list. */
@Serializable
internal data class StockRow(val id: Int, @SerialName("user_id") val userId: Int, val name: String, @SerialName("vorgabe") val default: Boolean)

@Serializable
internal data class MinifigRow(
    val id: Int? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("set_number") val setNumber: String? = null,
    val storage: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    @SerialName("owners") val owner: List<AccountRow> = emptyList(),
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("fig_name") val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("total_quantity") val totalQuantity: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val source: String = "set",
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

/** A purchase on a manual part or a figure. */
@Serializable
internal data class ValuationPurchaseRow(
    val id: Int = 0,
    val condition: Condition = Condition.NEW,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val valueTotal: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlPercent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("kaufpreis_original") val purchasePriceOriginal: Double = 0.0,
    @SerialName("kaufpreis_waehrung") val purchasePriceCurrency: String = "",
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
)

/** Ein manuell erfasstes Teil samt Bewertung. */
@Serializable
internal data class ManualPartRow(
    @SerialName("ausstehend") val pending: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val priceMax: Double? = null,
    @SerialName("min_price") val priceMin: Double? = null,
    @SerialName("acq_count") val purchaseCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    val source: String? = null,
    val id: Int? = null,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("qty_avg_price") val quantitiesCutPrice: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlPercent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val valueTotal: Double? = null,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    @SerialName("user_id") val accountId: Int? = null,
    @SerialName("owners") val owner: List<AccountRow> = emptyList(),
    val acquisitions: List<ValuationPurchaseRow> = emptyList(),
    val storage: String? = null,
)

/** Eine manuell erfasste Figur samt Bewertung. */
@Serializable
internal data class ManualMinifigRow(
    @SerialName("ausstehend") val pending: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val priceMax: Double? = null,
    @SerialName("min_price") val priceMin: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val source: String? = null,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("acq_count") val purchaseCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val id: Int? = null,
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("qty_avg_price") val quantitiesCutPrice: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlPercent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val valueTotal: Double? = null,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    @SerialName("user_id") val accountId: Int? = null,
    @SerialName("owners") val owner: List<AccountRow> = emptyList(),
    val acquisitions: List<ValuationPurchaseRow> = emptyList(),
    val storage: String? = null,
)

/** Without PIN: it never lies on disk (VouchersRepository.withoutSecret). */
@Serializable
internal data class VoucherRow(
    val id: Int = 0,
    val number: String = "",
    val amount: Double = 0.0,
    val currency: CurrencyCode = CurrencyCode.CHF,
    @SerialName("hat_pdf") val hasPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("guthaben_geprueft_am") val balanceCheckedAt: String? = null,
)

@Serializable
internal data class AlarmRow(
    @SerialName("set_number") val setNumber: String = "",
    val condition: Condition = Condition.NEW,
    @SerialName("richtung") val direction: AlarmDirection = AlarmDirection.BELOW,
    @SerialName("schwelle") val threshold: Double = 0.0,
    @SerialName("currency_code") val currencyCode: CurrencyCode = CurrencyCode.NONE,
    @SerialName("ausgeloest") val triggered: Boolean = false,
    @SerialName("zuletzt_am") val lastlyAt: String? = null,
    @SerialName("zuletzt_preis") val lastlyPrice: Double? = null,
    val name: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    @SerialName("besitzt") val owns: Boolean = true,
)

/** The key figures of the collection; [stats] is missing if the server sent none. */
@Serializable
internal data class MetricsRow(val success: Boolean = true, val stats: MetricsValuesRow? = null)

@Serializable
internal data class MetricsValuesRow(
    val currency: String? = null,
    @SerialName("default_condition") val defaultCondition: String? = null,
    @SerialName("user_default_condition") val accountDefaultState: String? = null,
    @SerialName("total_sets") val totalSets: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("total_pieces") val totalPieces: Int = 0,
    @SerialName("total_instructions") val totalInstructions: Int = 0,
    @SerialName("total_parts") val totalParts: Int = 0,
    @SerialName("set_parts") val setParts: Int? = null,
    @SerialName("manual_parts") val manualParts: Int? = null,
    @SerialName("total_minifigs") val totalMinifigs: Int = 0,
)

@Serializable
internal data class CatalogMetaRow(
    val success: Boolean = true,
    val themes: List<CatalogThemeRow> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearRow> = emptyList(),
)

@Serializable
internal data class CatalogThemeRow(val id: Int = 0, val name: String = "", @SerialName("set_count") val countSets: Int = 0)

@Serializable
internal data class CatalogYearRow(val year: Int = 0, val n: Int = 0)

/*
 * Row ↔ domain type. Amounts lie as numbers, points in time as ISO text as before; what only the
 * server's response carried (price range, cache marker), stays empty when writing.
 */
internal object StoreRows {
    private fun time(t: Instant?) = t?.toString()

    fun set(s: SetView) = SetRow(s.setNumber, s.name, s.year, s.theme, s.pieces, s.minifigs, s.quantity, s.imageUrl,
        s.imageLocal, time(s.addedAt), s.condition, s.storage, s.conditions, s.owners.map(::account),
        s.maxPurchasePrice?.asDouble(), s.avgPurchasePrice?.asDouble(), s.usedCount,
        s.instructions.map { InstructionRow(it.id, it.url, it.description, it.localPath, it.isManual) },
        s.bricklink?.let { BrickLinkRow(it.type, it.number, it.url, it.exact, it.resolved) }, s.priceComparisonUrl)

    fun set(z: SetRow) = SetView(setNumber = z.setNumber, name = z.name, year = z.year, theme = z.theme, pieces = z.pieces,
        minifigs = z.minifigs, quantity = z.quantity, imageUrl = z.imageUrl, imageLocal = z.imageLocal, addedAt = parseInstant(z.addedAt),
        condition = z.condition, storage = z.storage, conditions = z.conditions, owners = z.owners.map(::account),
        maxPurchasePrice = z.maxPurchasePrice.asMoney(), avgPurchasePrice = z.avgPurchasePrice.asMoney(), usedCount = z.usedCount ?: 0,
        instructions = z.instructions.map { InstructionView(id = it.id ?: 0, url = it.url, description = it.description, localPath = it.localPath, isManual = it.isManual) },
        bricklink = z.bricklink?.let { BrickLinkView(type = it.type, number = it.number, url = it.url, exact = it.exact, resolved = it.resolved) },
        priceComparisonUrl = z.priceComparisonUrl)

    fun remember(m: WantedItemView) = RememberRow(m.setNumber, m.condition, time(m.createdAt), m.userId, m.name, m.year, m.numParts,
        m.imageUrl, m.imageLocal, m.marketPrice?.asDouble(), m.currency, m.owned,
        m.alarm?.let { RememberAlarmRow(it.direction, it.threshold.asDouble(), it.triggered) }, m.priceComparisonUrl)

    fun remember(z: RememberRow) = WantedItemView(setNumber = z.setNumber, condition = z.condition, createdAt = parseInstant(z.createdAt),
        userId = z.userId, name = z.name, year = z.year, numParts = z.numParts, imageUrl = z.imageUrl, imageLocal = z.imageLocal,
        marketPrice = z.marketPrice.asMoney(), currency = z.currency, owned = z.owned,
        alarm = z.alarm?.let { WantedItemAlarmView(direction = it.direction, threshold = it.threshold.asMoneyRequired(), triggered = it.triggered) },
        priceComparisonUrl = z.priceComparisonUrl)

    fun part(p: PartView) = PartRow(p.partNumber, p.blPartNumber, p.partName, p.colorId, p.blColorId, p.colorName,
        p.colorHex, p.categoryName, p.imageUrl, p.imageLocal, p.totalQuantity, p.inSets, p.isSpare)

    fun part(z: PartRow) = PartView(partNumber = z.partNumber, blPartNumber = z.blPartNumber, partName = z.partName, colorId = z.colorId,
        blColorId = z.blColorId, colorName = z.colorName, colorHex = z.colorHex, categoryName = z.categoryName, imageUrl = z.imageUrl,
        imageLocal = z.imageLocal, totalQuantity = z.totalQuantity, inSets = z.inSets, isSpare = z.isSpare)

    private fun account(k: AccountView) = AccountRow(k.id, k.username)
    private fun account(z: AccountRow) = AccountView(id = z.id, username = z.username)

    fun figure(m: FigureView) = MinifigRow(figNumber = m.figNumber, condition = m.condition, conditions = m.conditions,
        owner = m.owners.map(::account), purchasePriceCut = m.avgPurchasePrice?.asDouble(), figName = m.figName, quantity = m.quantity,
        totalQuantity = m.totalQuantity, imageUrl = m.imageUrl, imageLocal = m.imageLocal, source = m.source.identifier, setAddedAt = time(m.setAddedAt))

    fun figure(z: MinifigRow) = FigureView(figNumber = z.figNumber, condition = z.condition, conditions = z.conditions,
        owners = z.owner.map(::account), avgPurchasePrice = z.purchasePriceCut.asMoney(), figName = z.figName, quantity = z.quantity,
        totalQuantity = z.totalQuantity, imageUrl = z.imageUrl, imageLocal = z.imageLocal, source = Origin.from(z.source),
        setAddedAt = parseInstant(z.setAddedAt))

    private fun purchase(a: ValuationPurchaseView) = ValuationPurchaseRow(id = a.id, condition = a.condition, quantity = a.quantity,
        purchasePrice = a.purchasePrice?.asDouble(), priceCut = a.avgPrice?.asDouble(), totalAvg = a.totalAvg,
        valueTotal = a.valueTotal?.asDouble(), pnlPct = a.pnlPct, pnlPercent = a.pnlPercent, createdAt = time(a.createdAt))

    private fun purchase(z: ValuationPurchaseRow) = ValuationPurchaseView(id = z.id, condition = z.condition, quantity = z.quantity,
        purchasePrice = z.purchasePrice.asMoney(), avgPrice = z.priceCut.asMoney(), totalAvg = z.totalAvg, valueTotal = z.valueTotal.asMoney(),
        pnlPct = z.pnlPct, pnlPercent = z.pnlPercent, createdAt = parseInstant(z.createdAt))

    fun manualPart(p: ManualPartView) = ManualPartRow(id = p.id, partNumber = p.partNumber, blPartNumber = p.blPartNumber,
        partName = p.partName, colorId = p.colorId, colorName = p.colorName, colorHex = p.colorHex, quantity = p.quantity, imageUrl = p.imageUrl,
        imageLocal = p.imageLocal, unitPrice = p.unitPrice?.asDouble(), purchasePrice = p.purchasePrice?.asDouble(),
        purchasePriceCut = p.avgPurchasePrice?.asDouble(), quantitiesCutPrice = p.qtyAvgPrice?.asDouble(), priceCut = p.avgPrice?.asDouble(),
        pnlPct = p.pnlPct, pnlPercent = p.pnlPercent, displayValue = p.displayValue, valueTotal = p.valueTotal?.asDouble(),
        condition = p.condition, conditions = p.conditions, accountId = p.userId, owner = p.owners.map(::account),
        acquisitions = p.acquisitions.map(::purchase), storage = p.storage)

    fun manualPart(z: ManualPartRow) = ManualPartView(id = z.id, partNumber = z.partNumber, blPartNumber = z.blPartNumber,
        partName = z.partName, colorId = z.colorId, colorName = z.colorName, colorHex = z.colorHex, quantity = z.quantity, imageUrl = z.imageUrl,
        imageLocal = z.imageLocal, unitPrice = z.unitPrice.asMoney(), purchasePrice = z.purchasePrice.asMoney(),
        avgPurchasePrice = z.purchasePriceCut.asMoney(), qtyAvgPrice = z.quantitiesCutPrice.asMoney(), avgPrice = z.priceCut.asMoney(),
        pnlPct = z.pnlPct, pnlPercent = z.pnlPercent, displayValue = z.displayValue, valueTotal = z.valueTotal.asMoney(),
        condition = z.condition, conditions = z.conditions, userId = z.accountId, owners = z.owner.map(::account),
        acquisitions = z.acquisitions.map(::purchase), storage = z.storage)

    fun manualMinifig(f: ManualMinifigView) = ManualMinifigRow(id = f.id, figNumber = f.figNumber, blFigNumber = f.blFigNumber,
        figName = f.figName, quantity = f.quantity, imageUrl = f.imageUrl, imageLocal = f.imageLocal, unitPrice = f.unitPrice?.asDouble(),
        purchasePrice = f.purchasePrice?.asDouble(), purchasePriceCut = f.avgPurchasePrice?.asDouble(),
        quantitiesCutPrice = f.qtyAvgPrice?.asDouble(), priceCut = f.avgPrice?.asDouble(), pnlPct = f.pnlPct, pnlPercent = f.pnlPercent,
        displayValue = f.displayValue, valueTotal = f.valueTotal?.asDouble(), condition = f.condition, conditions = f.conditions,
        accountId = f.userId, owner = f.owners.map(::account), acquisitions = f.acquisitions.map(::purchase), storage = f.storage)

    fun manualMinifig(z: ManualMinifigRow) = ManualMinifigView(id = z.id, figNumber = z.figNumber, blFigNumber = z.blFigNumber,
        figName = z.figName, quantity = z.quantity, imageUrl = z.imageUrl, imageLocal = z.imageLocal, unitPrice = z.unitPrice.asMoney(),
        purchasePrice = z.purchasePrice.asMoney(), avgPurchasePrice = z.purchasePriceCut.asMoney(), qtyAvgPrice = z.quantitiesCutPrice.asMoney(),
        avgPrice = z.priceCut.asMoney(), pnlPct = z.pnlPct, pnlPercent = z.pnlPercent, displayValue = z.displayValue,
        valueTotal = z.valueTotal.asMoney(), condition = z.condition, conditions = z.conditions, userId = z.accountId,
        owners = z.owner.map(::account), acquisitions = z.acquisitions.map(::purchase), storage = z.storage)

    /** The PIN is dropped here: it never belongs on disk. */
    fun voucher(g: VoucherView) = VoucherRow(g.id, g.number, g.amount.asDouble(), g.currency, g.hasPdf, time(g.createdAt),
        null, time(g.balanceCheckedAt))

    fun voucher(z: VoucherRow) = VoucherView(id = z.id, number = z.number, pin = null, amount = z.amount.asMoneyRequired(),
        currency = z.currency, hasPdf = z.hasPdf, createdAt = parseInstant(z.createdAt), balanceCheckedAt = parseInstant(z.balanceCheckedAt))

    fun alarm(a: PriceAlertView) = AlarmRow(a.setNumber, a.condition, a.direction, a.threshold.asDouble(), a.currencyCode, a.triggered,
        time(a.lastlyAt), a.lastlyPrice?.asDouble(), a.name, a.imageLocal, a.imageUrl, a.setImgUrl, a.owns)

    fun alarm(z: AlarmRow) = PriceAlertView(setNumber = z.setNumber, condition = z.condition, direction = z.direction,
        threshold = z.threshold.asMoneyRequired(), currencyCode = z.currencyCode, triggered = z.triggered, lastlyAt = parseInstant(z.lastlyAt),
        lastlyPrice = z.lastlyPrice.asMoney(), name = z.name, imageLocal = z.imageLocal, imageUrl = z.imageUrl, setImgUrl = z.setImgUrl,
        owns = z.owns)

    fun metrics(k: MetricsView) = MetricsRow(true, MetricsValuesRow(totalSets = k.totalSets,
        totalQuantity = k.totalQuantity, totalInstructions = k.totalInstructions, totalParts = k.totalParts, setParts = k.partsFromSets,
        manualParts = k.partsSingle, totalMinifigs = k.totalMinifigs))

    /** A row without values (older version, server without stats) is no key figure but unreadable. */
    fun metrics(z: MetricsRow) = checkNotNull(z.stats) { "Kennzahlen ohne Werte" }.let { d ->
        MetricsView(totalSets = d.totalSets, totalQuantity = d.totalQuantity, totalInstructions = d.totalInstructions,
            totalParts = d.totalParts, totalMinifigs = d.totalMinifigs, partsFromSets = d.setParts ?: d.manualParts?.let { d.totalParts - it },
            partsSingle = d.manualParts)
    }

    fun catalogMeta(m: CatalogMetaView) = CatalogMetaRow(true, m.themes.map { CatalogThemeRow(it.id, it.name, it.setCount) },
        m.yearMin, m.yearMax)

    fun catalogMeta(z: CatalogMetaRow) = CatalogMetaView(z.themes.map { CatalogThemeView(id = it.id, name = it.name, setCount = it.countSets) },
        z.yearMin, z.yearMax)

    fun stock(v: StockLocationView) = StockRow(v.location.id, v.location.userId, v.location.name, v.default)

    fun stock(z: StockRow) = StockLocationView(location = LocationEntryView(id = z.id, userId = z.userId, name = z.name), default = z.default)
}
