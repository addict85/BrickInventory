package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.alsGeld
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * Wie ein Posten des Ausgangs auf der Platte liegt (Fassung 1). Ein wartender Posten
 * existiert nur hier; hinge seine Form an den Fachtypen, machte eine Änderung dort ihn
 * nach dem Update unlesbar. Beträge liegen als Zahl wie in Fassung 1. Eine unverträgliche Änderung bekommt eine
 * neue Fassung daneben, Fassung 1 bleibt lesbar.
 */
internal object Ausgangsform {
    private val form = Ablageform(PostenF1.serializer(), ::alsForm, ::alsBearbeitung)

    fun kodiere(json: Json, b: Bearbeitung): String = form.kodiere(json, b)

    fun dekodiere(json: Json, text: String): Bearbeitung = form.dekodiere(json, text)

    /** Für den Hinweis zu einem unlesbaren Posten: die Nummer, falls sie sich noch finden lässt. */
    fun zielAus(json: Json, text: String): String? = runCatching {
        val o = json.parseToJsonElement(text).jsonObject
        val anfrage = o["anfrage"] as? JsonObject
        ZIELFELDER.firstNotNullOfOrNull { f -> ((o[f] ?: anfrage?.get(f)) as? JsonPrimitive)?.takeIf { it.isString }?.content }
    }.getOrNull()

    private val ZIELFELDER = listOf("setNumber", "partNumber", "figNumber", "set_number", "part_number", "fig_number")
}

private fun alsForm(b: Bearbeitung): PostenF1 = when (b) {
    is Bearbeitung.SetMenge -> PostenF1.SetMenge(b.setNumber, b.schritt)
    is Bearbeitung.SetErfassen -> with(b.wunsch) {
        PostenF1.SetErfassen(SetAnfrageF1(setNumber, menge, kaufpreis?.alsDouble(), zustand, besitzer, lagerort))
    }
    is Bearbeitung.MerkpostenAnlegen -> with(b.wunsch) { PostenF1.MerkpostenAnlegen(MerkAnfrageF1(setNumber, zustand, besitzer)) }
    is Bearbeitung.MerkpostenLoeschen -> PostenF1.MerkpostenLoeschen(b.setNumber, b.zustand, b.besitzer)
    is Bearbeitung.TeilErfassen -> with(b.erfassung) {
        PostenF1.TeilErfassen(TeilAnfrageF1(nummer, farbId, farbname, farbHex, menge, stueckpreis?.alsDouble(), zustand, besitzer, lagerort))
    }
    is Bearbeitung.TeilAendern -> PostenF1.TeilAendern(b.partNumber, b.colorId, form(b.aenderung), b.besitzer)
    is Bearbeitung.TeilLoeschen -> PostenF1.TeilLoeschen(b.partNumber, b.colorId, b.besitzer)
    is Bearbeitung.FigurErfassen -> with(b.erfassung) {
        PostenF1.FigurErfassen(FigurAnfrageF1(nummer, blNummer, menge, stueckpreis?.alsDouble(), zustand, besitzer, lagerort))
    }
    is Bearbeitung.FigurAendern -> PostenF1.FigurAendern(b.figNumber, form(b.aenderung), b.besitzer)
    is Bearbeitung.FigurLoeschen -> PostenF1.FigurLoeschen(b.figNumber, b.besitzer)
}

private fun alsBearbeitung(p: PostenF1): Bearbeitung = when (p) {
    is PostenF1.SetMenge -> Bearbeitung.SetMenge(p.setNumber, p.schritt)
    is PostenF1.SetErfassen -> with(p.anfrage) {
        Bearbeitung.SetErfassen(Erfassungswunsch(setNumber = setNumber, menge = quantity, kaufpreis = purchasePrice.alsGeld(),
            zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is PostenF1.MerkpostenAnlegen -> with(p.anfrage) { Bearbeitung.MerkpostenAnlegen(Merkwunsch(setNumber, condition, ownerUserId)) }
    is PostenF1.MerkpostenLoeschen -> Bearbeitung.MerkpostenLoeschen(p.setNumber, p.zustand, p.besitzer)
    is PostenF1.TeilErfassen -> with(p.anfrage) {
        Bearbeitung.TeilErfassen(Teilerfassung(nummer = partNumber, farbId = colorId, farbname = colorName, farbHex = colorHex,
            menge = quantity, stueckpreis = unitPrice.alsGeld(), zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is PostenF1.TeilAendern -> Bearbeitung.TeilAendern(p.partNumber, p.colorId, aenderung(p.anfrage), p.besitzer)
    is PostenF1.TeilLoeschen -> Bearbeitung.TeilLoeschen(p.partNumber, p.colorId, p.besitzer)
    is PostenF1.FigurErfassen -> with(p.anfrage) {
        Bearbeitung.FigurErfassen(Figurenerfassung(nummer = figNumber, blNummer = blFigNumber, menge = quantity,
            stueckpreis = unitPrice.alsGeld(), zustand = condition, besitzer = ownerUserId, lagerort = storage))
    }
    is PostenF1.FigurAendern -> Bearbeitung.FigurAendern(p.figNumber, aenderung(p.anfrage), p.besitzer)
    is PostenF1.FigurLoeschen -> Bearbeitung.FigurLoeschen(p.figNumber, p.besitzer)
}

private fun form(a: Stueckaenderung) = AenderungF1(a.menge, a.stueckpreis?.alsDouble(), a.blNummer, a.zustand, a.schritt)

private fun aenderung(a: AenderungF1) = Stueckaenderung(menge = a.quantity, schritt = a.quantityDelta, stueckpreis = a.unitPrice.alsGeld(),
    zustand = a.condition, blNummer = a.blFigNumber)

// Die Feldnamen sind die, unter denen Fassung 1 auf Geräten liegt; Vorgaben decken
// Posten älterer Apps, denen ein später dazugekommenes Feld fehlt.

@Serializable
internal sealed class PostenF1 {
    @Serializable @SerialName("set_menge")
    data class SetMenge(val setNumber: String, val schritt: Int) : PostenF1()

    @Serializable @SerialName("set_erfassen")
    data class SetErfassen(val anfrage: SetAnfrageF1) : PostenF1()

    @Serializable @SerialName("merkposten_anlegen")
    data class MerkpostenAnlegen(val anfrage: MerkAnfrageF1) : PostenF1()

    @Serializable @SerialName("merkposten_loeschen")
    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int? = null) : PostenF1()

    @Serializable @SerialName("teil_erfassen")
    data class TeilErfassen(val anfrage: TeilAnfrageF1) : PostenF1()

    @Serializable @SerialName("teil_aendern")
    data class TeilAendern(val partNumber: String, val colorId: Int, val anfrage: AenderungF1, val besitzer: Int? = null) : PostenF1()

    @Serializable @SerialName("teil_loeschen")
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int? = null) : PostenF1()

    @Serializable @SerialName("figur_erfassen")
    data class FigurErfassen(val anfrage: FigurAnfrageF1) : PostenF1()

    @Serializable @SerialName("figur_aendern")
    data class FigurAendern(val figNumber: String, val anfrage: AenderungF1, val besitzer: Int? = null) : PostenF1()

    @Serializable @SerialName("figur_loeschen")
    data class FigurLoeschen(val figNumber: String, val besitzer: Int? = null) : PostenF1()
}

@Serializable
internal data class SetAnfrageF1(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val storage: String? = null,
)

@Serializable
internal data class MerkAnfrageF1(
    @SerialName("set_number") val setNumber: String,
    val condition: Zustand = Zustand.NEU,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

/** 9999 ist „keine Farbe“ (KEINE_FARBE) — hier als Zahl, weil es die Platte so lesen muss. */
@Serializable
internal data class TeilAnfrageF1(
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
internal data class FigurAnfrageF1(
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
internal data class AenderungF1(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: Zustand? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("quantity_delta") val quantityDelta: Int? = null,
)
