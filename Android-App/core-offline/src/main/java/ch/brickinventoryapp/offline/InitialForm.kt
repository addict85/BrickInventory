package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand
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
    private val form = Ablageform(ItemF1.serializer(), ::asForm, ::asEditing)

    fun encode(json: Json, b: Editing): String = form.encode(json, b)

    fun decode(json: Json, text: String): Editing = form.decode(json, text)

    /** For the hint about an unreadable item: the number, if it can still be found. */
    fun targetFrom(json: Json, text: String): String? = runCatching {
        val o = json.parseToJsonElement(text).jsonObject
        val anfrage = o["anfrage"] as? JsonObject
        TARGET_FIELDS.firstNotNullOfOrNull { f -> ((o[f] ?: anfrage?.get(f)) as? JsonPrimitive)?.takeIf { it.isString }?.content }
    }.getOrNull()

    private val TARGET_FIELDS = listOf("setNumber", "partNumber", "figNumber", "set_number", "part_number", "fig_number")
}

private fun asForm(b: Editing): ItemF1 = when (b) {
    is Editing.SetMenge -> ItemF1.SetMenge(b.setNumber, b.schritt)
    is Editing.SetErfassen -> with(b.wish) {
        ItemF1.SetErfassen(SetRequestF1(setNumber, menge, kaufpreis?.asDouble(), zustand, besitzer, lagerort))
    }
    is Editing.MerkpostenAnlegen -> with(b.wish) { ItemF1.MerkpostenAnlegen(RememberRequestF1(setNumber, zustand, besitzer)) }
    is Editing.MerkpostenLoeschen -> ItemF1.MerkpostenLoeschen(b.setNumber, b.zustand, b.besitzer)
    is Editing.TeilErfassen -> with(b.erfassung) {
        ItemF1.TeilErfassen(PartRequestF1(nummer, farbId, farbname, farbHex, menge, stueckpreis?.asDouble(), zustand, besitzer, lagerort))
    }
    is Editing.TeilAendern -> ItemF1.TeilAendern(b.partNumber, b.colorId, form(b.aenderung), b.besitzer)
    is Editing.TeilLoeschen -> ItemF1.TeilLoeschen(b.partNumber, b.colorId, b.besitzer)
    is Editing.FigurErfassen -> with(b.erfassung) {
        ItemF1.FigurErfassen(MinifigRequestF1(nummer, blNumber, menge, stueckpreis?.asDouble(), zustand, besitzer, lagerort))
    }
    is Editing.FigurAendern -> ItemF1.FigurAendern(b.figNumber, form(b.aenderung), b.besitzer)
    is Editing.FigurLoeschen -> ItemF1.FigurLoeschen(b.figNumber, b.besitzer)
}

private fun asEditing(p: ItemF1): Editing = when (p) {
    is ItemF1.SetMenge -> Editing.SetMenge(p.setNumber, p.schritt)
    is ItemF1.SetErfassen -> with(p.anfrage) {
        Editing.SetErfassen(Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice.asMoney(),
            zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is ItemF1.MerkpostenAnlegen -> with(p.anfrage) { Editing.MerkpostenAnlegen(Merkwunsch(setNumber, condition, ownerUserId)) }
    is ItemF1.MerkpostenLoeschen -> Editing.MerkpostenLoeschen(p.setNumber, p.zustand, p.besitzer)
    is ItemF1.TeilErfassen -> with(p.anfrage) {
        Editing.TeilErfassen(Teilerfassung(nummer = partNumber, farbId = colorId, farbname = colorName, farbHex = colorHex,
            menge = quantity, stueckpreis = unitPrice.asMoney(), zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is ItemF1.TeilAendern -> Editing.TeilAendern(p.partNumber, p.colorId, aenderung(p.anfrage), p.besitzer)
    is ItemF1.TeilLoeschen -> Editing.TeilLoeschen(p.partNumber, p.colorId, p.besitzer)
    is ItemF1.FigurErfassen -> with(p.anfrage) {
        Editing.FigurErfassen(Figurenerfassung(nummer = figNumber, blNumber = blFigNumber, menge = quantity,
            stueckpreis = unitPrice.asMoney(), zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is ItemF1.FigurAendern -> Editing.FigurAendern(p.figNumber, aenderung(p.anfrage), p.besitzer)
    is ItemF1.FigurLoeschen -> Editing.FigurLoeschen(p.figNumber, p.besitzer)
}

private fun form(a: Stueckaenderung) = ChangeF1(a.menge, a.stueckpreis?.asDouble(), a.blNumber, a.zustand, a.schritt)

private fun aenderung(a: ChangeF1) = Stueckaenderung(menge = a.quantity, schritt = a.quantityDelta, stueckpreis = a.unitPrice.asMoney(),
    zustand = a.condition, blNumber = a.blFigNumber)

// The field names are those under which version 1 lies on devices; defaults cover
// items of older apps that lack a field added later.

@Serializable
internal sealed class ItemF1 {
    @Serializable @SerialName("set_menge")
    data class SetMenge(val setNumber: String, val schritt: Int) : ItemF1()

    @Serializable @SerialName("set_erfassen")
    data class SetErfassen(val anfrage: SetRequestF1) : ItemF1()

    @Serializable @SerialName("merkposten_anlegen")
    data class MerkpostenAnlegen(val anfrage: RememberRequestF1) : ItemF1()

    @Serializable @SerialName("merkposten_loeschen")
    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int? = null) : ItemF1()

    @Serializable @SerialName("teil_erfassen")
    data class TeilErfassen(val anfrage: PartRequestF1) : ItemF1()

    @Serializable @SerialName("teil_aendern")
    data class TeilAendern(val partNumber: String, val colorId: Int, val anfrage: ChangeF1, val besitzer: Int? = null) : ItemF1()

    @Serializable @SerialName("teil_loeschen")
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int? = null) : ItemF1()

    @Serializable @SerialName("figur_erfassen")
    data class FigurErfassen(val anfrage: MinifigRequestF1) : ItemF1()

    @Serializable @SerialName("figur_aendern")
    data class FigurAendern(val figNumber: String, val anfrage: ChangeF1, val besitzer: Int? = null) : ItemF1()

    @Serializable @SerialName("figur_loeschen")
    data class FigurLoeschen(val figNumber: String, val besitzer: Int? = null) : ItemF1()
}

@Serializable
internal data class SetRequestF1(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
internal data class RememberRequestF1(
    @SerialName("set_number") val setNumber: String,
    val condition: Zustand = Zustand.NEU,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

/** 9999 is „no color“ (KEINE_FARBE) — here as a number, because the disk must read it like that. */
@Serializable
internal data class PartRequestF1(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = 9999,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
internal data class MinifigRequestF1(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val quantity: Int = 1,
    @SerialName("unit_price") val unitPrice: Double? = null,
    val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
internal data class ChangeF1(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: Zustand? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("quantity_delta") val quantityDelta: Int? = null,
)
