package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.AnleitungAnsicht
import ch.brickinventoryapp.model.fach.BewertungsKaufAnsicht
import ch.brickinventoryapp.model.fach.BrickLinkAnsicht
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.GutscheinAnsicht
import ch.brickinventoryapp.model.fach.Herkunft
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.KatalogMetaAnsicht
import ch.brickinventoryapp.model.fach.KatalogThemaAnsicht
import ch.brickinventoryapp.model.fach.KennzahlenAnsicht
import ch.brickinventoryapp.model.fach.KontoAnsicht
import ch.brickinventoryapp.model.fach.LagerortEintragAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAlarmAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.PreisalarmAnsicht
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.VorratsOrtAnsicht
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.fach.alsGeldPflicht
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

/*
 * Zeile ↔ Fachtyp. Beträge liegen als Zahl, Zeitpunkte als ISO-Text wie früher; was nur die
 * Antwort des Servers trug (Preisspanne, Zwischenspeicher-Merker), bleibt beim Schreiben leer.
 */
internal object Ablagezeilen {
    private fun zeit(t: Instant?) = t?.toString()

    fun set(s: SetAnsicht) = SetZeile(s.setNumber, s.name, s.year, s.theme, s.pieces, s.minifigs, s.quantity, s.imageUrl,
        s.imageLocal, zeit(s.addedAt), s.condition, s.storage, s.conditions, s.owners.map(::konto),
        s.maxPurchasePrice?.alsDouble(), s.avgPurchasePrice?.alsDouble(), s.usedCount,
        s.instructions.map { AnleitungZeile(it.id, it.url, it.description, it.localPath, it.isManual) },
        s.bricklink?.let { BrickLinkZeile(it.type, it.number, it.url, it.exact, it.resolved) }, s.preisvergleichUrl)

    fun set(z: SetZeile) = SetAnsicht(setNumber = z.setNumber, name = z.name, year = z.year, theme = z.theme, pieces = z.pieces,
        minifigs = z.minifigs, quantity = z.quantity, imageUrl = z.imageUrl, imageLocal = z.imageLocal, addedAt = zeitpunkt(z.addedAt),
        condition = z.condition, storage = z.storage, conditions = z.conditions, owners = z.owners.map(::konto),
        maxPurchasePrice = z.maxPurchasePrice.alsGeld(), avgPurchasePrice = z.avgPurchasePrice.alsGeld(), usedCount = z.usedCount ?: 0,
        instructions = z.instructions.map { AnleitungAnsicht(id = it.id ?: 0, url = it.url, description = it.description, localPath = it.localPath, isManual = it.isManual) },
        bricklink = z.bricklink?.let { BrickLinkAnsicht(type = it.type, number = it.number, url = it.url, exact = it.exact, resolved = it.resolved) },
        preisvergleichUrl = z.preisvergleichUrl)

    fun merk(m: MerkpostenAnsicht) = MerkZeile(m.setNumber, m.condition, zeit(m.createdAt), m.userId, m.name, m.year, m.numParts,
        m.imageUrl, m.imageLocal, m.marktpreis?.alsDouble(), m.waehrung, m.owned,
        m.alarm?.let { MerkAlarmZeile(it.richtung, it.schwelle.alsDouble(), it.ausgeloest) }, m.preisvergleichUrl)

    fun merk(z: MerkZeile) = MerkpostenAnsicht(setNumber = z.setNumber, condition = z.condition, createdAt = zeitpunkt(z.createdAt),
        userId = z.userId, name = z.name, year = z.year, numParts = z.numParts, imageUrl = z.imageUrl, imageLocal = z.imageLocal,
        marktpreis = z.marktpreis.alsGeld(), waehrung = z.waehrung, owned = z.owned,
        alarm = z.alarm?.let { MerkpostenAlarmAnsicht(richtung = it.richtung, schwelle = it.schwelle.alsGeldPflicht(), ausgeloest = it.ausgeloest) },
        preisvergleichUrl = z.preisvergleichUrl)

    fun teil(p: TeilAnsicht) = TeilZeile(p.partNumber, p.blPartNumber, p.partName, p.colorId, p.blColorId, p.colorName,
        p.colorHex, p.categoryName, p.imageUrl, p.imageLocal, p.totalQuantity, p.inSets, p.isSpare)

    fun teil(z: TeilZeile) = TeilAnsicht(partNumber = z.partNumber, blPartNumber = z.blPartNumber, partName = z.partName, colorId = z.colorId,
        blColorId = z.blColorId, colorName = z.colorName, colorHex = z.colorHex, categoryName = z.categoryName, imageUrl = z.imageUrl,
        imageLocal = z.imageLocal, totalQuantity = z.totalQuantity, inSets = z.inSets, isSpare = z.isSpare)

    private fun konto(k: KontoAnsicht) = KontoZeile(k.id, k.username)
    private fun konto(z: KontoZeile) = KontoAnsicht(id = z.id, username = z.username)

    fun figur(m: FigurAnsicht) = FigurZeile(figNumber = m.figNumber, condition = m.condition, conditions = m.conditions,
        besitzer = m.owners.map(::konto), kaufpreisSchnitt = m.avgPurchasePrice?.alsDouble(), figName = m.figName, quantity = m.quantity,
        totalQuantity = m.totalQuantity, bildUrl = m.imageUrl, bildLokal = m.imageLocal, source = m.source.kennung, setAddedAt = zeit(m.setAddedAt))

    fun figur(z: FigurZeile) = FigurAnsicht(figNumber = z.figNumber, condition = z.condition, conditions = z.conditions,
        owners = z.besitzer.map(::konto), avgPurchasePrice = z.kaufpreisSchnitt.alsGeld(), figName = z.figName, quantity = z.quantity,
        totalQuantity = z.totalQuantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal, source = Herkunft.aus(z.source),
        setAddedAt = zeitpunkt(z.setAddedAt))

    private fun kauf(a: BewertungsKaufAnsicht) = BewertungsKaufZeile(id = a.id, condition = a.condition, quantity = a.quantity,
        kaufpreis = a.purchasePrice?.alsDouble(), preisSchnitt = a.avgPrice?.alsDouble(), totalAvg = a.totalAvg,
        wertGesamt = a.wertGesamt?.alsDouble(), pnlPct = a.pnlPct, pnlProzent = a.pnlProzent, createdAt = zeit(a.createdAt))

    private fun kauf(z: BewertungsKaufZeile) = BewertungsKaufAnsicht(id = z.id, condition = z.condition, quantity = z.quantity,
        purchasePrice = z.kaufpreis.alsGeld(), avgPrice = z.preisSchnitt.alsGeld(), totalAvg = z.totalAvg, wertGesamt = z.wertGesamt.alsGeld(),
        pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, createdAt = zeitpunkt(z.createdAt))

    fun manuellesTeil(p: ManuellesTeilAnsicht) = ManuellesTeilZeile(id = p.id, partNumber = p.partNumber, blPartNumber = p.blPartNumber,
        partName = p.partName, farbId = p.colorId, farbname = p.colorName, farbHex = p.colorHex, quantity = p.quantity, bildUrl = p.imageUrl,
        bildLokal = p.imageLocal, stueckpreis = p.unitPrice?.alsDouble(), kaufpreis = p.purchasePrice?.alsDouble(),
        kaufpreisSchnitt = p.avgPurchasePrice?.alsDouble(), mengenSchnittpreis = p.qtyAvgPrice?.alsDouble(), preisSchnitt = p.avgPrice?.alsDouble(),
        pnlPct = p.pnlPct, pnlProzent = p.pnlProzent, anzeigeWert = p.displayValue, wertGesamt = p.wertGesamt?.alsDouble(),
        condition = p.condition, conditions = p.conditions, kontoId = p.userId, besitzer = p.owners.map(::konto),
        acquisitions = p.acquisitions.map(::kauf), storage = p.storage)

    fun manuellesTeil(z: ManuellesTeilZeile) = ManuellesTeilAnsicht(id = z.id, partNumber = z.partNumber, blPartNumber = z.blPartNumber,
        partName = z.partName, colorId = z.farbId, colorName = z.farbname, colorHex = z.farbHex, quantity = z.quantity, imageUrl = z.bildUrl,
        imageLocal = z.bildLokal, unitPrice = z.stueckpreis.alsGeld(), purchasePrice = z.kaufpreis.alsGeld(),
        avgPurchasePrice = z.kaufpreisSchnitt.alsGeld(), qtyAvgPrice = z.mengenSchnittpreis.alsGeld(), avgPrice = z.preisSchnitt.alsGeld(),
        pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert, wertGesamt = z.wertGesamt.alsGeld(),
        condition = z.condition, conditions = z.conditions, userId = z.kontoId, owners = z.besitzer.map(::konto),
        acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    fun manuelleFigur(f: ManuelleFigurAnsicht) = ManuelleFigurZeile(id = f.id, figNumber = f.figNumber, blFigNumber = f.blFigNumber,
        figName = f.figName, quantity = f.quantity, bildUrl = f.imageUrl, bildLokal = f.imageLocal, stueckpreis = f.unitPrice?.alsDouble(),
        kaufpreis = f.purchasePrice?.alsDouble(), kaufpreisSchnitt = f.avgPurchasePrice?.alsDouble(),
        mengenSchnittpreis = f.qtyAvgPrice?.alsDouble(), preisSchnitt = f.avgPrice?.alsDouble(), pnlPct = f.pnlPct, pnlProzent = f.pnlProzent,
        anzeigeWert = f.displayValue, wertGesamt = f.wertGesamt?.alsDouble(), condition = f.condition, conditions = f.conditions,
        kontoId = f.userId, besitzer = f.owners.map(::konto), acquisitions = f.acquisitions.map(::kauf), storage = f.storage)

    fun manuelleFigur(z: ManuelleFigurZeile) = ManuelleFigurAnsicht(id = z.id, figNumber = z.figNumber, blFigNumber = z.blFigNumber,
        figName = z.figName, quantity = z.quantity, imageUrl = z.bildUrl, imageLocal = z.bildLokal, unitPrice = z.stueckpreis.alsGeld(),
        purchasePrice = z.kaufpreis.alsGeld(), avgPurchasePrice = z.kaufpreisSchnitt.alsGeld(), qtyAvgPrice = z.mengenSchnittpreis.alsGeld(),
        avgPrice = z.preisSchnitt.alsGeld(), pnlPct = z.pnlPct, pnlProzent = z.pnlProzent, displayValue = z.anzeigeWert,
        wertGesamt = z.wertGesamt.alsGeld(), condition = z.condition, conditions = z.conditions, userId = z.kontoId,
        owners = z.besitzer.map(::konto), acquisitions = z.acquisitions.map(::kauf), storage = z.storage)

    /** Die PIN fällt hier weg: Sie gehört nie auf die Platte. */
    fun gutschein(g: GutscheinAnsicht) = GutscheinZeile(g.id, g.number, g.amount.alsDouble(), g.currency, g.hatPdf, zeit(g.createdAt),
        null, zeit(g.guthabenGeprueftAm))

    fun gutschein(z: GutscheinZeile) = GutscheinAnsicht(id = z.id, number = z.number, pin = null, amount = z.amount.alsGeldPflicht(),
        currency = z.currency, hatPdf = z.hatPdf, createdAt = zeitpunkt(z.createdAt), guthabenGeprueftAm = zeitpunkt(z.guthabenGeprueftAm))

    fun alarm(a: PreisalarmAnsicht) = AlarmZeile(a.setNumber, a.condition, a.richtung, a.schwelle.alsDouble(), a.currencyCode, a.ausgeloest,
        zeit(a.zuletztAm), a.zuletztPreis?.alsDouble(), a.name, a.imageLocal, a.imageUrl, a.setImgUrl, a.besitzt)

    fun alarm(z: AlarmZeile) = PreisalarmAnsicht(setNumber = z.setNumber, condition = z.condition, richtung = z.richtung,
        schwelle = z.schwelle.alsGeldPflicht(), currencyCode = z.currencyCode, ausgeloest = z.ausgeloest, zuletztAm = zeitpunkt(z.zuletztAm),
        zuletztPreis = z.zuletztPreis.alsGeld(), name = z.name, imageLocal = z.bildLokal, imageUrl = z.bildUrl, setImgUrl = z.setImgUrl,
        besitzt = z.besitzt)

    fun kennzahlen(k: KennzahlenAnsicht) = KennzahlenZeile(true, KennzahlenWerteZeile(totalSets = k.totalSets,
        totalQuantity = k.totalQuantity, totalInstructions = k.totalInstructions, totalParts = k.totalParts, setParts = k.teileAusSets,
        manualParts = k.teileEinzeln, totalMinifigs = k.totalMinifigs))

    /** Eine Zeile ohne Werte (ältere Fassung, Server ohne stats) ist keine Kennzahl, sondern unlesbar. */
    fun kennzahlen(z: KennzahlenZeile) = checkNotNull(z.stats) { "Kennzahlen ohne Werte" }.let { d ->
        KennzahlenAnsicht(totalSets = d.totalSets, totalQuantity = d.totalQuantity, totalInstructions = d.totalInstructions,
            totalParts = d.totalParts, totalMinifigs = d.totalMinifigs, teileAusSets = d.setParts ?: d.manualParts?.let { d.totalParts - it },
            teileEinzeln = d.manualParts)
    }

    fun katalogMeta(m: KatalogMetaAnsicht) = KatalogMetaZeile(true, m.themen.map { KatalogThemaZeile(it.id, it.name, it.setCount) },
        m.jahrMin, m.jahrMax)

    fun katalogMeta(z: KatalogMetaZeile) = KatalogMetaAnsicht(z.themes.map { KatalogThemaAnsicht(id = it.id, name = it.name, setCount = it.anzahlSets) },
        z.yearMin, z.yearMax)

    fun vorrat(v: VorratsOrtAnsicht) = VorratZeile(v.ort.id, v.ort.userId, v.ort.name, v.vorgabe)

    fun vorrat(z: VorratZeile) = VorratsOrtAnsicht(ort = LagerortEintragAnsicht(id = z.id, userId = z.userId, name = z.name), vorgabe = z.vorgabe)
}
