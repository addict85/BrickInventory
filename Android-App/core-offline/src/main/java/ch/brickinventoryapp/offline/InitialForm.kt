package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.domain.asMoney
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * How an outbox item lies on disk (version 1). A waiting item
 * exists only here; if its form hung on the domain types, a change there would make it
 * unreadable after the update. Amounts lie as numbers as in version 1. An incompatible change gets a
 * new version next to it, version 1 stays readable.
 */
internal object InitialForm {
    private val form = StoreShape(ItemF1.serializer(), ::asForm, ::asEditing)

    fun encode(json: Json, b: Editing): String = form.encode(json, b)

    fun decode(json: Json, text: String): Editing = form.decode(json, text)

    /** For the hint about an unreadable item: the number, if it can still be found. */
    fun targetFrom(json: Json, text: String): String? = runCatching {
        val o = json.parseToJsonElement(text).jsonObject
        val request = o["anfrage"] as? JsonObject
        TARGET_FIELDS.firstNotNullOfOrNull { f -> ((o[f] ?: request?.get(f)) as? JsonPrimitive)?.takeIf { it.isString }?.content }
    }.getOrNull()

    private val TARGET_FIELDS = listOf("setNumber", "partNumber", "figNumber", "set_number", "part_number", "fig_number")
}

private fun asForm(b: Editing): ItemF1 = when (b) {
    is Editing.SetQuantity -> ItemF1.SetQuantity(b.setNumber, b.step)
    is Editing.RecordSet -> with(b.wish) {
        ItemF1.RecordSet(SetRequestF1(setNumber, quantity, purchasePrice?.asDouble(), condition, owner, storageLocation))
    }
    is Editing.CreateWantedItem -> with(b.wish) { ItemF1.CreateWantedItem(RememberRequestF1(setNumber, condition, owner)) }
    is Editing.DeleteWantedItem -> ItemF1.DeleteWantedItem(b.setNumber, b.condition, b.owner)
    is Editing.RecordPart -> with(b.entry) {
        ItemF1.RecordPart(PartRequestF1(number, colorId, colorName, colorHex, quantity, unitPrice?.asDouble(), condition, owner, storageLocation))
    }
    is Editing.EditPart -> ItemF1.EditPart(b.partNumber, b.colorId, form(b.change), b.owner)
    is Editing.DeletePart -> ItemF1.DeletePart(b.partNumber, b.colorId, b.owner)
    is Editing.RecordFigure -> with(b.entry) {
        ItemF1.RecordFigure(MinifigRequestF1(number, blNumber, quantity, unitPrice?.asDouble(), condition, owner, storageLocation))
    }
    is Editing.EditFigure -> ItemF1.EditFigure(b.figNumber, form(b.change), b.owner)
    is Editing.DeleteFigure -> ItemF1.DeleteFigure(b.figNumber, b.owner)
}

private fun asEditing(p: ItemF1): Editing = when (p) {
    is ItemF1.SetQuantity -> Editing.SetQuantity(p.setNumber, p.step)
    is ItemF1.RecordSet -> with(p.request) {
        Editing.RecordSet(EntryRequest(setNumber = setNumber, quantity = quantity, purchasePrice = purchasePrice.asMoney(),
            condition = condition, owner = ownerUserId, storageLocation = storage))
    }
    is ItemF1.CreateWantedItem -> with(p.request) { Editing.CreateWantedItem(WantedRequest(setNumber, condition, ownerUserId)) }
    is ItemF1.DeleteWantedItem -> Editing.DeleteWantedItem(p.setNumber, p.condition, p.owner)
    is ItemF1.RecordPart -> with(p.request) {
        Editing.RecordPart(PartEntry(number = partNumber, colorId = colorId, colorName = colorName, colorHex = colorHex,
            quantity = quantity, unitPrice = unitPrice.asMoney(), condition = condition, owner = ownerUserId, storageLocation = storage))
    }
    is ItemF1.EditPart -> Editing.EditPart(p.partNumber, p.colorId, change(p.request), p.owner)
    is ItemF1.DeletePart -> Editing.DeletePart(p.partNumber, p.colorId, p.owner)
    is ItemF1.RecordFigure -> with(p.request) {
        Editing.RecordFigure(FigureEntry(number = figNumber, blNumber = blFigNumber, quantity = quantity,
            unitPrice = unitPrice.asMoney(), condition = condition, owner = ownerUserId, storageLocation = storage))
    }
    is ItemF1.EditFigure -> Editing.EditFigure(p.figNumber, change(p.request), p.owner)
    is ItemF1.DeleteFigure -> Editing.DeleteFigure(p.figNumber, p.owner)
}

private fun form(a: QuantityChange) = ChangeF1(a.quantity, a.unitPrice?.asDouble(), a.blNumber, a.condition, a.step)

private fun change(a: ChangeF1) = QuantityChange(quantity = a.quantity, step = a.quantityDelta, unitPrice = a.unitPrice.asMoney(),
    condition = a.condition, blNumber = a.blFigNumber)

// The field names are those under which version 1 lies on devices; defaults cover
// items of older apps that lack a field added later.

@Serializable
internal sealed class ItemF1 {
    @Serializable @SerialName("set_menge")
    data class SetQuantity(val setNumber: String, @SerialName("schritt") val step: Int) : ItemF1()

    @Serializable @SerialName("set_erfassen")
    data class RecordSet(@SerialName("anfrage") val request: SetRequestF1) : ItemF1()

    @Serializable @SerialName("merkposten_anlegen")
    data class CreateWantedItem(@SerialName("anfrage") val request: RememberRequestF1) : ItemF1()

    @Serializable @SerialName("merkposten_loeschen")
    data class DeleteWantedItem(val setNumber: String, @SerialName("zustand") val condition: Condition, @SerialName("besitzer") val owner: Int? = null) : ItemF1()

    @Serializable @SerialName("teil_erfassen")
    data class RecordPart(@SerialName("anfrage") val request: PartRequestF1) : ItemF1()

    @Serializable @SerialName("teil_aendern")
    data class EditPart(val partNumber: String, val colorId: Int, @SerialName("anfrage") val request: ChangeF1, @SerialName("besitzer") val owner: Int? = null) : ItemF1()

    @Serializable @SerialName("teil_loeschen")
    data class DeletePart(val partNumber: String, val colorId: Int, @SerialName("besitzer") val owner: Int? = null) : ItemF1()

    @Serializable @SerialName("figur_erfassen")
    data class RecordFigure(@SerialName("anfrage") val request: MinifigRequestF1) : ItemF1()

    @Serializable @SerialName("figur_aendern")
    data class EditFigure(val figNumber: String, @SerialName("anfrage") val request: ChangeF1, @SerialName("besitzer") val owner: Int? = null) : ItemF1()

    @Serializable @SerialName("figur_loeschen")
    data class DeleteFigure(val figNumber: String, @SerialName("besitzer") val owner: Int? = null) : ItemF1()
}

@Serializable
internal data class SetRequestF1(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
internal data class RememberRequestF1(
    @SerialName("set_number") val setNumber: String,
    val condition: Condition = Condition.NEW,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

/** 9999 is „no color“ (NO_COLOR) — here as a number, because the disk must read it like that. */
@Serializable
internal data class PartRequestF1(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = 9999,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
internal data class MinifigRequestF1(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
internal data class ChangeF1(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: Condition? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("quantity_delta") val quantityDelta: Int? = null,
)
