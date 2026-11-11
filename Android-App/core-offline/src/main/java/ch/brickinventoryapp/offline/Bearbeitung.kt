package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.data.model.AddMinifigRequest
import ch.brickinventoryapp.model.data.model.AddPartRequest
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.MerkpostenRequest
import ch.brickinventoryapp.model.data.model.UpdateManualItemRequest
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
sealed class Bearbeitung : Offlineablage.Wirkung {
    /** Welche lokale Liste die Änderung betrifft. */
    abstract val art: Bestandsart

    override val arten: Set<Bestandsart> get() = setOf(art)

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
    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = setNumber
    }

    @Serializable @SerialName("teil_erfassen")
    data class TeilErfassen(val anfrage: AddPartRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = anfrage.partNumber
    }

    /**
     * Die Anfrage trägt die neue Menge und, wenn die bisherige bekannt war, den
     * Schritt dorthin: Ein Server mit quantity_delta zählt zwei Geräte zusammen,
     * einer ohne nimmt die Menge — dann gewinnt wie früher der Letzte.
     */
    @Serializable @SerialName("teil_aendern")
    data class TeilAendern(val partNumber: String, val colorId: Int, val anfrage: UpdateManualItemRequest,
                           val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    /** Löschen wartet wie jede Änderung; was der Server schon nicht mehr kennt, gilt als gelöscht. */
    @Serializable @SerialName("teil_loeschen")
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int?) : Bearbeitung() {
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

    @Serializable @SerialName("figur_loeschen")
    data class FigurLoeschen(val figNumber: String, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }
}
