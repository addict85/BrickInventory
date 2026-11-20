package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.InstructionView
import ch.brickinventoryapp.model.fach.ValuationPurchaseView
import ch.brickinventoryapp.model.fach.BrickLinkView
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.VoucherView
import ch.brickinventoryapp.model.fach.Herkunft
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.CatalogMetaView
import ch.brickinventoryapp.model.fach.CatalogThemeView
import ch.brickinventoryapp.model.fach.MetricsView
import ch.brickinventoryapp.model.fach.AccountView
import ch.brickinventoryapp.model.fach.LocationEntryView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.WantedItemAlarmView
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.StockLocationView
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.asMoneyRequired
import ch.brickinventoryapp.model.util.zeitpunkt
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/*
 * Die Ablageform jedes Fachs, Fassung 1. Die Feldnamen sind eingefroren auf das, was
 * früher als Servermodell abgelegt wurde: Ältere Zeilen bleiben lesbar, und eine
 * Änderung am Fachtyp ändert nur die Abbildung hier, nicht die Platte.
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
    val condition: Zustand? = null,
    val storage: String? = null,
    val conditions: List<Zustand> = emptyList(),
    val owners: List<AccountRow> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<InstructionRow> = emptyList(),
    val bricklink: BrickLinkRow? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
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
    val condition: Zustand = Zustand.NEU,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val marktpreis: Double? = null,
    val waehrung: Waehrung = Waehrung.EUR,
    val owned: Boolean = false,
    val alarm: RememberAlarmRow? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
internal data class RememberAlarmRow(
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Double = 0.0,
    val ausgeloest: Boolean = false,
)

@Serializable
internal data class PartRow(
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
    @SerialName("is_spare") val isSpare: Boolean = false,
)

/** Ein Ort im Vorrat; [vorgabe] markiert den Stern, den der Server neben der Liste schickt. */
@Serializable
internal data class StockRow(val id: Int, @SerialName("user_id") val userId: Int, val name: String, val vorgabe: Boolean)

@Serializable
internal data class MinifigRow(
    val id: Int? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("set_number") val setNumber: String? = null,
    val storage: String? = null,
    @SerialName("unit_price") val stueckpreis: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("owners") val besitzer: List<AccountRow> = emptyList(),
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("fig_name") val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("total_quantity") val totalQuantity: Int? = null,
    @SerialName("image_url") val bildUrl: String? = null,
    @SerialName("image_local") val bildLokal: String? = null,
    val source: String = "set",
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

/** Ein Kauf an einem manuellen Teil oder einer Figur. */
@Serializable
internal data class ValuationPurchaseRow(
    val id: Int = 0,
    val condition: Zustand = Zustand.NEU,
    val quantity: Int = 1,
    @SerialName("purchase_price") val kaufpreis: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double = 0.0,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String = "",
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
)

/** Ein manuell erfasstes Teil samt Bewertung. */
@Serializable
internal data class ManualPartRow(
    val ausstehend: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val priceMax: Double? = null,
    @SerialName("min_price") val priceMin: Double? = null,
    @SerialName("acq_count") val purchaseCount: Int? = null,
    @SerialName("used_count") val gebrauchtAnzahl: Int? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    val source: String? = null,
    val id: Int? = null,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val farbId: Int = KEINE_FARBE,
    @SerialName("color_name") val farbname: String? = null,
    @SerialName("color_hex") val farbHex: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val bildUrl: String? = null,
    @SerialName("image_local") val bildLokal: String? = null,
    @SerialName("unit_price") val stueckpreis: Double? = null,
    @SerialName("purchase_price") val kaufpreis: Double? = null,
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("qty_avg_price") val quantitiesCutPrice: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val anzeigeWert: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val accountId: Int? = null,
    @SerialName("owners") val besitzer: List<AccountRow> = emptyList(),
    val acquisitions: List<ValuationPurchaseRow> = emptyList(),
    val storage: String? = null,
)

/** Eine manuell erfasste Figur samt Bewertung. */
@Serializable
internal data class ManualMinifigRow(
    val ausstehend: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val priceMax: Double? = null,
    @SerialName("min_price") val priceMin: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val source: String? = null,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("acq_count") val purchaseCount: Int? = null,
    @SerialName("used_count") val gebrauchtAnzahl: Int? = null,
    val id: Int? = null,
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val bildUrl: String? = null,
    @SerialName("image_local") val bildLokal: String? = null,
    @SerialName("unit_price") val stueckpreis: Double? = null,
    @SerialName("purchase_price") val kaufpreis: Double? = null,
    @SerialName("avg_purchase_price") val purchasePriceCut: Double? = null,
    @SerialName("qty_avg_price") val quantitiesCutPrice: Double? = null,
    @SerialName("avg_price") val priceCut: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val anzeigeWert: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val accountId: Int? = null,
    @SerialName("owners") val besitzer: List<AccountRow> = emptyList(),
    val acquisitions: List<ValuationPurchaseRow> = emptyList(),
    val storage: String? = null,
)

/** Ohne PIN: Sie liegt nie auf der Platte (VouchersRepository.withoutSecret). */
@Serializable
internal data class VoucherRow(
    val id: Int = 0,
    val number: String = "",
    val amount: Double = 0.0,
    val currency: Waehrung = Waehrung.CHF,
    @SerialName("hat_pdf") val hatPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("guthaben_geprueft_am") val guthabenGeprueftAm: String? = null,
)

@Serializable
internal data class AlarmRow(
    @SerialName("set_number") val setNumber: String = "",
    val condition: Zustand = Zustand.NEU,
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Double = 0.0,
    @SerialName("currency_code") val currencyCode: Waehrung = Waehrung.KEINE,
    val ausgeloest: Boolean = false,
    @SerialName("zuletzt_am") val lastlyAt: String? = null,
    @SerialName("zuletzt_preis") val lastlyPrice: Double? = null,
    val name: String? = null,
    @SerialName("image_local") val bildLokal: String? = null,
    @SerialName("image_url") val bildUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    val besitzt: Boolean = true,
)

/** Die Kennzahlen der Sammlung; [stats] fehlt, wenn der Server keine schickte. */
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
 * Zeile ↔ Fachtyp. Beträge liegen als Zahl, Zeitpunkte als ISO-Text wie früher; was nur die
 * Antwort des Servers trug (Preisspanne, Zwischenspeicher-Merker), bleibt beim Schreiben leer.
 */
internal object Ablagezeilen {
    private fun zeit(t: Instant?) = t?.toString()

    fun set(s: SetAnsicht) = SetRow(s.setNumber, s.name, s.year, s.theme, s.pieces, s.minifigs, s.quantity, s.imageUrl,
        s.imageLocal, zeit(s.addedAt), s.condition, s.storage, s.conditions, s.owners.map(::konto),
        s.maxPurchasePrice?.asDouble(), s.avgPurchasePrice?.asDouble(), s.usedCount,
        s.instructions.map { InstructionRow(it.id, it.url, it.description, it.localPath, it.isManual) },
        s.bricklink?.let { BrickLinkRow(it.type, it.number, it.url, it.exact, it.resolved) }, s.preisvergleichUrl)

    fun set(z: SetRow) = SetAnsicht(setNumber = z.setNumber, name = z.name, year = z.year, theme = z.theme, pieces = z.pieces,
        minifigs = z.minifigs, quantity = z.quantity, imageUrl = z.imageUrl, imageLocal = z.imageLocal, addedAt = zeitpunkt(z.addedAt),
        condition = z.condition, storage = z.storage, conditions = z.conditions, owners = z.owners.map(::konto),
        maxPurchasePrice = z.maxPurchasePrice.asMoney(), avgPurchasePrice = z.avgPurchasePrice.asMoney(), usedCount = z.usedCount ?: 0,
        instructions = z.instructions.map { InstructionView(id = it.id ?: 0, url = it.url, description = it.description, localPath = it.localPath, isManual = it.isManual) },
        bricklink = z.bricklink?.let { BrickLinkView(type = it.type, number = it.number, url = it.url, exact = it.exact, resolved = it.resolved) },
        preisvergleichUrl = z.preisvergleichUrl)

    fun remember(m: WantedItemView) = RememberRow(m.setNumber, m.condition, zeit(m.createdAt), m.userId, m.name, m.year, m.numParts,
        m.imageUrl, m.imageLocal, m.marktpreis?.asDouble(), m.waehrung, m.owned,
        m.alarm?.let { RememberAlarmRow(it.richtung, it.schwelle.asDouble(), it.ausgeloest) }, m.preisvergleichUrl)

    fun remember(z: RememberRow) = WantedItemView(setNumber = z.setNumber, condition = z.condition, createdAt = zeitpunkt(z.createdAt),
        userId = z.userId, name = z.name, year = z.year, numParts = z.numParts, imageUrl = z.imageUrl, imageLocal = z.imageLocal,
        marktpreis = z.marktpreis.asMoney(), waehrung = z.waehrung, owned = z.owned,
        alarm = z.alarm?.let { WantedItemAlarmView(richtung = it.richtung, schwelle = it.schwelle.asMoneyRequired(), ausgeloest = it.ausgeloest) },
        preisvergleichUrl = z.preisvergleichUrl)

    fun teil(p: TeilAnsicht) = PartRow(p.partNumber, p.blPartNumber, p.partName, p.colorId, p.blColorId, p.colorName,
        p.colorHex, p.categoryName, p.imageUrl, p.imageLocal, p.totalQuantity, p.inSets, p.isSpare)

    fun teil(z: PartRow) = TeilAnsicht(partNumber = z.partNumber, blPartNumber = z.blPartNumber, partName = z.partName, colorId = z.colorId,
        blColorId = z.blColorId, colorName = z.colorName, colorHex = z.colorHex, categoryName = z.categoryName, imageUrl = z.imageUrl,
        imageLocal = z.imageLocal, totalQuantity = z.totalQuantity, inSets = z.inSets, isSpare = z.isSpare)

    private fun konto(k: AccountView) = AccountRow(k.id, k.username)
    private fun konto(z: AccountRow) = AccountView(id = z.id, username = z.username)

    fun figur(m: FigurAnsicht) = MinifigRow(figNumber = m.figNumber, condition = m.condition, conditions = m.conditions,
        besitzer = m.owners.map(::konto), purchasePriceCut = m.avgPurchasePrice?.asDouble(), figName = m.figName, quantity = m.quantity,
        totalQuantity = m.totalQuantity, bildUrl = m.imageUrl, bildLokal = m.imageLocal, source = m.source.kennung, setAddedAt = zeit(m.setAddedAt))

    fun figur(z: MinifigRow) = FigurAnsicht(figNumber = z.figNumber, condition = z.condition, conditions = z.conditions,
        owners = z.besitzer.map(::konto), avgPurchasePrice = z.purchasePriceCut.asMoney(), figName = z.figName, quantity = z.quantity,
        totalQuantity = z.totalQuantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal, source = Herkunft.aus(z.source),
        setAddedAt = zeitpunkt(z.setAddedAt))

    private fun kauf(a: ValuationPurchaseView) = ValuationPurchaseRow(id = a.id, condition = a.condition, quantity = a.quantity,
        kaufpreis = a.purchasePrice?.asDouble(), priceCut = a.avgPrice?.asDouble(), totalAvg = a.totalAvg,
        wertGesamt = a.wertGesamt?.asDouble(), pnlPct = a.pnlPct, pnlProzent = a.pnlProzent, createdAt = zeit(a.createdAt))

    private fun kauf(z: ValuationPurchaseRow) = ValuationPurchaseView(id = z.id, condition = z.condition, quantity = z.quantity,
        purchasePrice = z.kaufpreis.asMoney(), avgPrice = z.priceCut.asMoney(), totalAvg = z.totalAvg, wertGesamt = z.wertGesamt.asMoney(),
        pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, createdAt = zeitpunkt(z.createdAt))

    fun manualPart(p: ManualPartView) = ManualPartRow(id = p.id, partNumber = p.partNumber, blPartNumber = p.blPartNumber,
        partName = p.partName, farbId = p.colorId, farbname = p.colorName, farbHex = p.colorHex, quantity = p.quantity, bildUrl = p.imageUrl,
        bildLokal = p.imageLocal, stueckpreis = p.unitPrice?.asDouble(), kaufpreis = p.purchasePrice?.asDouble(),
        purchasePriceCut = p.avgPurchasePrice?.asDouble(), quantitiesCutPrice = p.qtyAvgPrice?.asDouble(), priceCut = p.avgPrice?.asDouble(),
        pnlPct = p.pnlPct, pnlProzent = p.pnlProzent, anzeigeWert = p.displayValue, wertGesamt = p.wertGesamt?.asDouble(),
        condition = p.condition, conditions = p.conditions, accountId = p.userId, besitzer = p.owners.map(::konto),
        acquisitions = p.acquisitions.map(::kauf), storage = p.storage)

    fun manualPart(z: ManualPartRow) = ManualPartView(id = z.id, partNumber = z.partNumber, blPartNumber = z.blPartNumber,
        partName = z.partName, colorId = z.farbId, colorName = z.farbname, colorHex = z.farbHex, quantity = z.quantity, imageUrl = z.bildUrl,
        imageLocal = z.bildLokal, unitPrice = z.stueckpreis.asMoney(), purchasePrice = z.kaufpreis.asMoney(),
        avgPurchasePrice = z.purchasePriceCut.asMoney(), qtyAvgPrice = z.quantitiesCutPrice.asMoney(), avgPrice = z.priceCut.asMoney(),
        pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert, wertGesamt = z.wertGesamt.asMoney(),
        condition = z.condition, conditions = z.conditions, userId = z.accountId, owners = z.besitzer.map(::konto),
        acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    fun manualMinifig(f: ManualMinifigView) = ManualMinifigRow(id = f.id, figNumber = f.figNumber, blFigNumber = f.blFigNumber,
        figName = f.figName, quantity = f.quantity, bildUrl = f.imageUrl, bildLokal = f.imageLocal, stueckpreis = f.unitPrice?.asDouble(),
        kaufpreis = f.purchasePrice?.asDouble(), purchasePriceCut = f.avgPurchasePrice?.asDouble(),
        quantitiesCutPrice = f.qtyAvgPrice?.asDouble(), priceCut = f.avgPrice?.asDouble(), pnlPct = f.pnlPct, pnlProzent = f.pnlProzent,
        anzeigeWert = f.displayValue, wertGesamt = f.wertGesamt?.asDouble(), condition = f.condition, conditions = f.conditions,
        accountId = f.userId, besitzer = f.owners.map(::konto), acquisitions = f.acquisitions.map(::kauf), storage = f.storage)

    fun manualMinifig(z: ManualMinifigRow) = ManualMinifigView(id = z.id, figNumber = z.figNumber, blFigNumber = z.blFigNumber,
        figName = z.figName, quantity = z.quantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal, unitPrice = z.stueckpreis.asMoney(),
        purchasePrice = z.kaufpreis.asMoney(), avgPurchasePrice = z.purchasePriceCut.asMoney(), qtyAvgPrice = z.quantitiesCutPrice.asMoney(),
        avgPrice = z.priceCut.asMoney(), pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert,
        wertGesamt = z.wertGesamt.asMoney(), condition = z.condition, conditions = z.conditions, userId = z.accountId,
        owners = z.besitzer.map(::konto), acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    /** Die PIN fällt hier weg: Sie gehört nie auf die Platte. */
    fun gutschein(g: VoucherView) = VoucherRow(g.id, g.number, g.amount.asDouble(), g.currency, g.hatPdf, zeit(g.createdAt),
        null, zeit(g.guthabenGeprueftAm))

    fun gutschein(z: VoucherRow) = VoucherView(id = z.id, number = z.number, pin = null, amount = z.amount.asMoneyRequired(),
        currency = z.currency, hatPdf = z.hatPdf, createdAt = zeitpunkt(z.createdAt), guthabenGeprueftAm = zeitpunkt(z.guthabenGeprueftAm))

    fun alarm(a: PriceAlertView) = AlarmRow(a.setNumber, a.condition, a.richtung, a.schwelle.asDouble(), a.currencyCode, a.ausgeloest,
        zeit(a.lastlyAt), a.lastlyPrice?.asDouble(), a.name, a.imageLocal, a.imageUrl, a.setImgUrl, a.besitzt)

    fun alarm(z: AlarmRow) = PriceAlertView(setNumber = z.setNumber, condition = z.condition, richtung = z.richtung,
        schwelle = z.schwelle.asMoneyRequired(), currencyCode = z.currencyCode, ausgeloest = z.ausgeloest, lastlyAt = zeitpunkt(z.lastlyAt),
        lastlyPrice = z.lastlyPrice.asMoney(), name = z.name, imageLocal = z.bildLokal, imageUrl = z.bildUrl, setImgUrl = z.setImgUrl,
        besitzt = z.besitzt)

    fun metrics(k: MetricsView) = MetricsRow(true, MetricsValuesRow(totalSets = k.totalSets,
        totalQuantity = k.totalQuantity, totalInstructions = k.totalInstructions, totalParts = k.totalParts, setParts = k.partsFromSets,
        manualParts = k.partsSingle, totalMinifigs = k.totalMinifigs))

    /** Eine Zeile ohne Werte (ältere Fassung, Server ohne stats) ist keine Kennzahl, sondern unlesbar. */
    fun metrics(z: MetricsRow) = checkNotNull(z.stats) { "Kennzahlen ohne Werte" }.let { d ->
        MetricsView(totalSets = d.totalSets, totalQuantity = d.totalQuantity, totalInstructions = d.totalInstructions,
            totalParts = d.totalParts, totalMinifigs = d.totalMinifigs, partsFromSets = d.setParts ?: d.manualParts?.let { d.totalParts - it },
            partsSingle = d.manualParts)
    }

    fun catalogMeta(m: CatalogMetaView) = CatalogMetaRow(true, m.themen.map { CatalogThemeRow(it.id, it.name, it.setCount) },
        m.jahrMin, m.jahrMax)

    fun catalogMeta(z: CatalogMetaRow) = CatalogMetaView(z.themes.map { CatalogThemeView(id = it.id, name = it.name, setCount = it.countSets) },
        z.yearMin, z.yearMax)

    fun stock(v: StockLocationView) = StockRow(v.ort.id, v.ort.userId, v.ort.name, v.vorgabe)

    fun stock(z: StockRow) = StockLocationView(ort = LocationEntryView(id = z.id, userId = z.userId, name = z.name), vorgabe = z.vorgabe)
}
