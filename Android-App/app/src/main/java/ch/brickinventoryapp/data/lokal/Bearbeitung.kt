package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.model.AddMinifigRequest
import ch.brickinventoryapp.data.model.AddPartRequest
import ch.brickinventoryapp.data.model.AddSetRequest
import ch.brickinventoryapp.data.model.MerkpostenRequest
import ch.brickinventoryapp.data.model.UpdateManualItemRequest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Eine Änderung, die ohne Verbindung im Ausgang wartet. Sie trägt genau die
 * Anfrage, die online gegangen wäre — beim Senden entsteht nichts Neues, und
 * der Server entscheidet wie sonst auch. Mengen von Sets gehen als Schritt,
 * damit zwei Geräte, die offline je +1 tippen, zusammen +2 ergeben.
 */
@Serializable
sealed class Bearbeitung {
    /** Welche lokale Liste die Änderung betrifft. */
    abstract val art: Bestandsart

    /** Wofür die Änderung gilt (Set-, Teile- oder Figurennummer) — für den Hinweis. */
    abstract val ziel: String

    @Serializable @SerialName("set_menge")
    data class SetMenge(val setNumber: String, val schritt: Int) : Bearbeitung() {
        override val art get() = Bestandsart.SETS
        override val ziel get() = setNumber
    }

    @Serializable @SerialName("set_erfassen")
    data class SetErfassen(val anfrage: AddSetRequest) : Bearbeitung() {
        override val art get() = Bestandsart.SETS
        override val ziel get() = anfrage.setNumber
    }

    @Serializable @SerialName("merkposten_anlegen")
    data class MerkpostenAnlegen(val anfrage: MerkpostenRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = anfrage.setNumber
    }

    @Serializable @SerialName("merkposten_loeschen")
    data class MerkpostenLoeschen(val setNumber: String, val zustand: String, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = setNumber
    }

    @Serializable @SerialName("teil_erfassen")
    data class TeilErfassen(val anfrage: AddPartRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = anfrage.partNumber
    }

    /** Teile und Figuren kennt der Server nur mit absoluter Menge; der Letzte gewinnt. */
    @Serializable @SerialName("teil_aendern")
    data class TeilAendern(val partNumber: String, val colorId: Int, val anfrage: UpdateManualItemRequest,
                           val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    @Serializable @SerialName("figur_erfassen")
    data class FigurErfassen(val anfrage: AddMinifigRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = anfrage.figNumber
    }

    @Serializable @SerialName("figur_aendern")
    data class FigurAendern(val figNumber: String, val anfrage: UpdateManualItemRequest,
                            val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }
}
