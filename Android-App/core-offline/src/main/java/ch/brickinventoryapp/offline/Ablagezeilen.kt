package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.data.model.BrickLinkRef
import ch.brickinventoryapp.model.data.model.Instruction
import ch.brickinventoryapp.model.data.model.KEINE_FARBE
import ch.brickinventoryapp.model.data.model.KontoName
import ch.brickinventoryapp.model.data.model.LagerortEintrag
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.MerkpostenAlarm
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.VorratsOrt
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Die Ablageform der Listen, die am häufigsten ihr Servermodell ändern. Die
 * Feldnamen sind eingefroren auf das, was früher als Servermodell abgelegt
 * wurde: Ältere Zeilen bleiben lesbar, und eine Änderung am Netzmodell ändert
 * nur die Abbildung hier, nicht die Platte.
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

internal object Ablagezeilen {
    fun set(s: SetItem) = SetZeile(s.setNumber, s.name, s.year, s.theme, s.pieces, s.minifigs, s.quantity, s.imageUrl,
        s.imageLocal, s.addedAt, s.condition, s.storage, s.conditions, s.owners.map { KontoZeile(it.id, it.username) },
        s.maxPurchasePrice, s.avgPurchasePrice, s.usedCount,
        s.instructions.map { AnleitungZeile(it.id, it.url, it.description, it.localPath, it.isManual) },
        s.bricklink?.let { BrickLinkZeile(it.type, it.number, it.url, it.exact, it.resolved) }, s.preisvergleichUrl)

    fun set(z: SetZeile) = SetItem(z.setNumber, z.name, z.year, z.theme, z.pieces, z.minifigs, z.quantity, z.imageUrl,
        z.imageLocal, z.addedAt, z.condition, z.storage, z.conditions, z.owners.map { KontoName(it.id, it.username) },
        z.maxPurchasePrice, z.avgPurchasePrice, z.usedCount,
        z.instructions.map { Instruction(it.id, it.url, it.description, it.localPath, it.isManual) },
        z.bricklink?.let { BrickLinkRef(it.type, it.number, it.url, it.exact, it.resolved) }, z.preisvergleichUrl)

    fun merk(m: Merkposten) = MerkZeile(m.setNumber, m.condition, m.createdAt, m.userId, m.name, m.year, m.numParts,
        m.imageUrl, m.imageLocal, m.marktpreis, m.waehrung, m.owned,
        m.alarm?.let { MerkAlarmZeile(it.richtung, it.schwelle, it.ausgeloest) }, m.preisvergleichUrl)

    fun merk(z: MerkZeile) = Merkposten(z.setNumber, z.condition, z.createdAt, z.userId, z.name, z.year, z.numParts,
        z.imageUrl, z.imageLocal, z.marktpreis, z.waehrung, z.owned,
        z.alarm?.let { MerkpostenAlarm(it.richtung, it.schwelle, it.ausgeloest) }, z.preisvergleichUrl)

    fun teil(p: Part) = TeilZeile(p.partNumber, p.blPartNumber, p.partName, p.colorId, p.blColorId, p.colorName,
        p.colorHex, p.categoryName, p.imageUrl, p.imageLocal, p.totalQuantity, p.inSets, p.isSpare)

    fun teil(z: TeilZeile) = Part(z.partNumber, z.blPartNumber, z.partName, z.colorId, z.blColorId, z.colorName,
        z.colorHex, z.categoryName, z.imageUrl, z.imageLocal, z.totalQuantity, z.inSets, z.isSpare)

    fun vorrat(v: VorratsOrt) = VorratZeile(v.ort.id, v.ort.userId, v.ort.name, v.vorgabe)

    fun vorrat(z: VorratZeile) = VorratsOrt(LagerortEintrag(z.id, z.userId, z.name), z.vorgabe)
}
