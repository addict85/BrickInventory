package ch.brickinventoryapp.offline

import ch.brickinventoryapp.vertrag.BrickLinkRef
import ch.brickinventoryapp.vertrag.CatalogMetaResponse
import ch.brickinventoryapp.vertrag.CatalogTheme
import ch.brickinventoryapp.vertrag.CatalogYearCount
import ch.brickinventoryapp.vertrag.DashboardStats
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.Minifig
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.vertrag.ValuationAcquisition
import ch.brickinventoryapp.vertrag.Instruction
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.LagerortEintrag
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAlarm
import ch.brickinventoryapp.vertrag.Part
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.vertrag.VorratsOrt
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Die Ablageform jedes Fachs, Fassung 1. Die Feldnamen sind eingefroren auf das, was
 * früher als Servermodell abgelegt wurde: Ältere Zeilen bleiben lesbar, und eine
 * Änderung am Netzmodell ändert nur die Abbildung hier, nicht die Platte.
 */

@Serializable
internal data class SetZeile(
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
    val owners: List<KontoZeile> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<AnleitungZeile> = emptyList(),
    val bricklink: BrickLinkZeile? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
internal data class KontoZeile(val id: Int = 0, val username: String = "")

@Serializable
internal data class AnleitungZeile(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    @SerialName("is_manual") val isManual: Boolean = false,
)

@Serializable
internal data class BrickLinkZeile(
    val type: String = "SET",
    val number: String = "",
    val url: String? = null,
    val exact: Boolean = true,
    val resolved: Boolean = false,
)

@Serializable
internal data class MerkZeile(
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
    val alarm: MerkAlarmZeile? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
internal data class MerkAlarmZeile(
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Double = 0.0,
    val ausgeloest: Boolean = false,
)

@Serializable
internal data class TeilZeile(
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
internal data class VorratZeile(val id: Int, @SerialName("user_id") val userId: Int, val name: String, val vorgabe: Boolean)

@Serializable
internal data class FigurZeile(
    val id: Int? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("owner_ids") val besitzerIds: List<Int> = emptyList(),
    @SerialName("set_number") val setNumber: String? = null,
    val storage: String? = null,
    @SerialName("unit_price") val stueckpreis: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("owners") val besitzer: List<KontoZeile> = emptyList(),
    @SerialName("avg_purchase_price") val kaufpreisSchnitt: Double? = null,
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
internal data class BewertungsKaufZeile(
    val id: Int = 0,
    val condition: Zustand = Zustand.NEU,
    val quantity: Int = 1,
    @SerialName("purchase_price") val kaufpreis: Double? = null,
    @SerialName("avg_price") val preisSchnitt: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val besitzerId: Int? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double = 0.0,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String = "",
    @SerialName("price_estimated") val preisGeschaetzt: Boolean = false,
)

/** Ein manuell erfasstes Teil samt Bewertung. */
@Serializable
internal data class ManuellesTeilZeile(
    val ausstehend: Boolean = false,
    @SerialName("from_cache") val ausZwischenspeicher: Boolean = false,
    @SerialName("max_price") val preisMax: Double? = null,
    @SerialName("min_price") val preisMin: Double? = null,
    @SerialName("acq_count") val kaufAnzahl: Int? = null,
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
    @SerialName("avg_purchase_price") val kaufpreisSchnitt: Double? = null,
    @SerialName("qty_avg_price") val mengenSchnittpreis: Double? = null,
    @SerialName("avg_price") val preisSchnitt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val anzeigeWert: String? = null,
    @SerialName("total_value") val gesamtWert: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val kontoId: Int? = null,
    @SerialName("owners") val besitzer: List<KontoZeile> = emptyList(),
    val acquisitions: List<BewertungsKaufZeile> = emptyList(),
    val storage: String? = null,
)

/** Eine manuell erfasste Figur samt Bewertung. */
@Serializable
internal data class ManuelleFigurZeile(
    val ausstehend: Boolean = false,
    @SerialName("from_cache") val ausZwischenspeicher: Boolean = false,
    @SerialName("max_price") val preisMax: Double? = null,
    @SerialName("min_price") val preisMin: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val source: String? = null,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("acq_count") val kaufAnzahl: Int? = null,
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
    @SerialName("avg_purchase_price") val kaufpreisSchnitt: Double? = null,
    @SerialName("qty_avg_price") val mengenSchnittpreis: Double? = null,
    @SerialName("avg_price") val preisSchnitt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val anzeigeWert: String? = null,
    @SerialName("total_value") val gesamtWert: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val kontoId: Int? = null,
    @SerialName("owners") val besitzer: List<KontoZeile> = emptyList(),
    val acquisitions: List<BewertungsKaufZeile> = emptyList(),
    val storage: String? = null,
)

/** Ohne PIN: Sie liegt nie auf der Platte (GutscheineRepository.ohneGeheimnis). */
@Serializable
internal data class GutscheinZeile(
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
internal data class AlarmZeile(
    @SerialName("set_number") val setNumber: String = "",
    val condition: Zustand = Zustand.NEU,
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Double = 0.0,
    @SerialName("currency_code") val currencyCode: Waehrung = Waehrung.KEINE,
    val ausgeloest: Boolean = false,
    @SerialName("zuletzt_am") val zuletztAm: String? = null,
    @SerialName("zuletzt_preis") val zuletztPreis: Double? = null,
    val name: String? = null,
    @SerialName("image_local") val bildLokal: String? = null,
    @SerialName("image_url") val bildUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    val besitzt: Boolean = true,
)

/** Die Kennzahlen der Sammlung; [stats] fehlt, wenn der Server keine schickte. */
@Serializable
internal data class KennzahlenZeile(val success: Boolean = true, val stats: KennzahlenWerteZeile? = null)

@Serializable
internal data class KennzahlenWerteZeile(
    val currency: String? = null,
    @SerialName("default_condition") val defaultCondition: String? = null,
    @SerialName("user_default_condition") val kontoVorgabeZustand: String? = null,
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
internal data class KatalogMetaZeile(
    val success: Boolean = true,
    val themes: List<KatalogThemaZeile> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<KatalogJahrZeile> = emptyList(),
)

@Serializable
internal data class KatalogThemaZeile(val id: Int = 0, val name: String = "", @SerialName("set_count") val anzahlSets: Int = 0)

@Serializable
internal data class KatalogJahrZeile(val year: Int = 0, val n: Int = 0)

internal object Ablagezeilen {
    fun set(s: SetItem) = SetZeile(s.setNumber, s.name, s.year, s.theme, s.pieces, s.minifigs, s.quantity, s.imageUrl,
        s.imageLocal, s.addedAt, s.condition, s.storage, s.conditions, s.owners.map { KontoZeile(it.id, it.username) },
        s.maxPurchasePrice, s.avgPurchasePrice, s.usedCount,
        s.instructions.map { AnleitungZeile(it.id, it.url, it.description, it.localPath, it.isManual) },
        s.bricklink?.let { BrickLinkZeile(it.type, it.number, it.url, it.exact, it.resolved) }, s.preisvergleichUrl)

    fun set(z: SetZeile) = SetItem(setNumber = z.setNumber, name = z.name, year = z.year, theme = z.theme, pieces = z.pieces, minifigs = z.minifigs, quantity = z.quantity, imageUrl = z.imageUrl,
        imageLocal = z.imageLocal, addedAt = z.addedAt, condition = z.condition, storage = z.storage, conditions = z.conditions, owners = z.owners.map { KontoName(id = it.id, username = it.username) },
        maxPurchasePrice = z.maxPurchasePrice, avgPurchasePrice = z.avgPurchasePrice, usedCount = z.usedCount,
        instructions = z.instructions.map { Instruction(id = it.id, url = it.url, description = it.description, localPath = it.localPath, isManual = it.isManual) },
        bricklink = z.bricklink?.let { BrickLinkRef(type = it.type, number = it.number, url = it.url, exact = it.exact, resolved = it.resolved) }, preisvergleichUrl = z.preisvergleichUrl)

    fun merk(m: Merkposten) = MerkZeile(m.setNumber, m.condition, m.createdAt, m.userId, m.name, m.year, m.numParts,
        m.imageUrl, m.imageLocal, m.marktpreis, m.waehrung, m.owned,
        m.alarm?.let { MerkAlarmZeile(it.richtung, it.schwelle, it.ausgeloest) }, m.preisvergleichUrl)

    fun merk(z: MerkZeile) = Merkposten(setNumber = z.setNumber, condition = z.condition, createdAt = z.createdAt, userId = z.userId, name = z.name, year = z.year, numParts = z.numParts,
        imageUrl = z.imageUrl, imageLocal = z.imageLocal, marktpreis = z.marktpreis, waehrung = z.waehrung, owned = z.owned,
        alarm = z.alarm?.let { MerkpostenAlarm(richtung = it.richtung, schwelle = it.schwelle, ausgeloest = it.ausgeloest) }, preisvergleichUrl = z.preisvergleichUrl)

    fun teil(p: Part) = TeilZeile(p.partNumber, p.blPartNumber, p.partName, p.colorId, p.blColorId, p.colorName,
        p.colorHex, p.categoryName, p.imageUrl, p.imageLocal, p.totalQuantity, p.inSets, p.isSpare)

    fun teil(z: TeilZeile) = Part(partNumber = z.partNumber, blPartNumber = z.blPartNumber, partName = z.partName, colorId = z.colorId, blColorId = z.blColorId, colorName = z.colorName,
        colorHex = z.colorHex, categoryName = z.categoryName, imageUrl = z.imageUrl, imageLocal = z.imageLocal, totalQuantity = z.totalQuantity, inSets = z.inSets, isSpare = z.isSpare)

    private fun konto(k: KontoName) = KontoZeile(k.id, k.username)
    private fun konto(z: KontoZeile) = KontoName(id = z.id, username = z.username)

    fun figur(m: Minifig) = FigurZeile(m.id, m.inSets, m.ownerIds, m.setNumber, m.storage, m.unitPrice, m.figNumber, m.condition,
        m.conditions, m.owners.map(::konto), m.avgPurchasePrice, m.figName, m.quantity, m.totalQuantity, m.imageUrl, m.imageLocal,
        m.source, m.setAddedAt)

    fun figur(z: FigurZeile) = Minifig(id = z.id, inSets = z.inSets, ownerIds = z.besitzerIds, setNumber = z.setNumber, storage = z.storage,
        unitPrice = z.stueckpreis, figNumber = z.figNumber, condition = z.condition, conditions = z.conditions, owners = z.besitzer.map(::konto),
        avgPurchasePrice = z.kaufpreisSchnitt, figName = z.figName, quantity = z.quantity, totalQuantity = z.totalQuantity,
        imageUrl = z.bildUrl, imageLocal = z.bildLokal, source = z.source, setAddedAt = z.setAddedAt)

    private fun kauf(a: ValuationAcquisition) = BewertungsKaufZeile(a.id, a.condition, a.quantity, a.purchasePrice, a.avgPrice, a.totalAvg,
        a.wertGesamt, a.pnlPct, a.pnlProzent, a.createdAt, a.ownerUserId, a.kaufpreisOriginal, a.kaufpreisWaehrung, a.priceEstimated)

    private fun kauf(z: BewertungsKaufZeile) = ValuationAcquisition(id = z.id, condition = z.condition, quantity = z.quantity,
        purchasePrice = z.kaufpreis, avgPrice = z.preisSchnitt, totalAvg = z.totalAvg, wertGesamt = z.wertGesamt, pnlPct = z.pnlPct,
        pnlProzent = z.pnlProzent, createdAt = z.createdAt, ownerUserId = z.besitzerId, kaufpreisOriginal = z.kaufpreisOriginal,
        kaufpreisWaehrung = z.kaufpreisWaehrung, priceEstimated = z.preisGeschaetzt)

    fun manuellesTeil(p: PartValuationItem) = ManuellesTeilZeile(p.ausstehend, p.fromCache, p.maxPrice, p.minPrice, p.acqCount, p.usedCount,
        p.categoryName, p.createdAt, p.source, p.id, p.partNumber, p.blPartNumber, p.partName, p.colorId, p.colorName, p.colorHex,
        p.quantity, p.imageUrl, p.imageLocal, p.unitPrice, p.purchasePrice, p.avgPurchasePrice, p.qtyAvgPrice, p.avgPrice, p.pnlPct,
        p.pnlProzent, p.displayValue, p.totalValue, p.wertGesamt, p.condition, p.conditions, p.userId, p.owners.map(::konto),
        p.acquisitions.map(::kauf), p.storage)

    fun manuellesTeil(z: ManuellesTeilZeile) = PartValuationItem(ausstehend = z.ausstehend, fromCache = z.ausZwischenspeicher, maxPrice = z.preisMax,
        minPrice = z.preisMin, acqCount = z.kaufAnzahl, usedCount = z.gebrauchtAnzahl, categoryName = z.categoryName, createdAt = z.createdAt,
        source = z.source, id = z.id, partNumber = z.partNumber, blPartNumber = z.blPartNumber, partName = z.partName, colorId = z.farbId,
        colorName = z.farbname, colorHex = z.farbHex, quantity = z.quantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal,
        unitPrice = z.stueckpreis, purchasePrice = z.kaufpreis, avgPurchasePrice = z.kaufpreisSchnitt, qtyAvgPrice = z.mengenSchnittpreis,
        avgPrice = z.preisSchnitt, pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert, totalValue = z.gesamtWert,
        wertGesamt = z.wertGesamt, condition = z.condition, conditions = z.conditions, userId = z.kontoId, owners = z.besitzer.map(::konto),
        acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    fun manuelleFigur(f: FigValuationItem) = ManuelleFigurZeile(f.ausstehend, f.fromCache, f.maxPrice, f.minPrice, f.setNumber, f.source,
        f.storageId, f.acqCount, f.usedCount, f.id, f.figNumber, f.blFigNumber, f.figName, f.quantity, f.imageUrl, f.imageLocal,
        f.unitPrice, f.purchasePrice, f.avgPurchasePrice, f.qtyAvgPrice, f.avgPrice, f.pnlPct, f.pnlProzent, f.displayValue,
        f.totalValue, f.wertGesamt, f.condition, f.conditions, f.userId, f.owners.map(::konto), f.acquisitions.map(::kauf), f.storage)

    fun manuelleFigur(z: ManuelleFigurZeile) = FigValuationItem(ausstehend = z.ausstehend, fromCache = z.ausZwischenspeicher, maxPrice = z.preisMax,
        minPrice = z.preisMin, setNumber = z.setNumber, source = z.source, storageId = z.storageId, acqCount = z.kaufAnzahl,
        usedCount = z.gebrauchtAnzahl, id = z.id, figNumber = z.figNumber, blFigNumber = z.blFigNumber, figName = z.figName,
        quantity = z.quantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal, unitPrice = z.stueckpreis, purchasePrice = z.kaufpreis,
        avgPurchasePrice = z.kaufpreisSchnitt, qtyAvgPrice = z.mengenSchnittpreis, avgPrice = z.preisSchnitt, pnlPct = z.pnlPct,
        pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert, totalValue = z.gesamtWert, wertGesamt = z.wertGesamt,
        condition = z.condition, conditions = z.conditions, userId = z.kontoId, owners = z.besitzer.map(::konto),
        acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    /** Die PIN fällt hier weg: Sie gehört nie auf die Platte. */
    fun gutschein(g: Gutschein) = GutscheinZeile(g.id, g.number, g.amount, g.currency, g.hatPdf, g.createdAt, g.updatedAt, g.guthabenGeprueftAm)

    fun gutschein(z: GutscheinZeile) = Gutschein(id = z.id, number = z.number, amount = z.amount, currency = z.currency, hatPdf = z.hatPdf,
        createdAt = z.createdAt, updatedAt = z.updatedAt, guthabenGeprueftAm = z.guthabenGeprueftAm)

    fun alarm(a: Preisalarm) = AlarmZeile(a.setNumber, a.condition, a.richtung, a.schwelle, a.currencyCode, a.ausgeloest, a.zuletztAm,
        a.zuletztPreis, a.name, a.imageLocal, a.imageUrl, a.setImgUrl, a.besitzt)

    fun alarm(z: AlarmZeile) = Preisalarm(setNumber = z.setNumber, condition = z.condition, richtung = z.richtung, schwelle = z.schwelle,
        currencyCode = z.currencyCode, ausgeloest = z.ausgeloest, zuletztAm = z.zuletztAm, zuletztPreis = z.zuletztPreis, name = z.name,
        imageLocal = z.bildLokal, imageUrl = z.bildUrl, setImgUrl = z.setImgUrl, besitzt = z.besitzt)

    fun kennzahlen(s: StatsResponse) = KennzahlenZeile(s.success, s.stats?.let { d ->
        KennzahlenWerteZeile(d.currency, d.defaultCondition, d.userDefaultCondition, d.totalSets, d.totalQuantity, d.totalPieces,
            d.totalInstructions, d.totalParts, d.setParts, d.manualParts, d.totalMinifigs)
    })

    fun kennzahlen(z: KennzahlenZeile) = StatsResponse(success = z.success, stats = z.stats?.let { d ->
        DashboardStats(currency = d.currency, defaultCondition = d.defaultCondition, userDefaultCondition = d.kontoVorgabeZustand,
            totalSets = d.totalSets, totalQuantity = d.totalQuantity, totalPieces = d.totalPieces, totalInstructions = d.totalInstructions,
            totalParts = d.totalParts, setParts = d.setParts, manualParts = d.manualParts, totalMinifigs = d.totalMinifigs)
    })

    fun katalogMeta(m: CatalogMetaResponse) = KatalogMetaZeile(m.success, m.themes.map { KatalogThemaZeile(it.id, it.name, it.setCount) },
        m.yearMin, m.yearMax, m.yearCounts.map { KatalogJahrZeile(it.year, it.n) })

    fun katalogMeta(z: KatalogMetaZeile) = CatalogMetaResponse(success = z.success,
        themes = z.themes.map { CatalogTheme(id = it.id, name = it.name, setCount = it.anzahlSets) }, yearMin = z.yearMin, yearMax = z.yearMax,
        yearCounts = z.yearCounts.map { CatalogYearCount(year = it.year, n = it.n) })

    fun vorrat(v: VorratsOrt) = VorratZeile(v.ort.id, v.ort.userId, v.ort.name, v.vorgabe)

    fun vorrat(z: VorratZeile) = VorratsOrt(ort = LagerortEintrag(id = z.id, userId = z.userId, name = z.name), vorgabe = z.vorgabe)
}
