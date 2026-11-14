package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.data.model.AddMinifigRequest
import ch.brickinventoryapp.model.data.model.AddPartRequest
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.MerkpostenRequest
import ch.brickinventoryapp.model.data.model.UpdateManualItemRequest
import ch.brickinventoryapp.model.fach.Zustand

/**
 * Eine Änderung, die ohne Verbindung im Ausgang wartet, mit genau der Anfrage, die
 * online gegangen wäre; Mengen von Sets gehen als Schritt, damit zwei Geräte zusammen
 * +2 ergeben. Auf der Platte liegt sie als [Ausgangsform]: Die Server-Anfragen hier
 * ändern sich mit dem Server, wartende Posten nicht.
 */
sealed class Bearbeitung : Offlineablage.Wirkung {
    /** Welche lokale Liste die Änderung betrifft. */
    abstract val art: Bestandsart

    override val arten: Set<Bestandsart> get() = setOf(art)

    /** Wofür die Änderung gilt (Set-, Teile- oder Figurennummer) — für den Hinweis. */
    abstract val ziel: String

    data class SetMenge(val setNumber: String, val schritt: Int) : Bearbeitung() {
        override val art get() = Bestandsart.SETS
        override val ziel get() = setNumber
    }

    data class SetErfassen(val anfrage: AddSetRequest) : Bearbeitung() {
        override val art get() = Bestandsart.SETS
        override val ziel get() = anfrage.setNumber
    }

    data class MerkpostenAnlegen(val anfrage: MerkpostenRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = anfrage.setNumber
    }

    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = setNumber
    }

    data class TeilErfassen(val anfrage: AddPartRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = anfrage.partNumber
    }

    /**
     * Die Anfrage trägt die neue Menge und, wenn die bisherige bekannt war, den
     * Schritt dorthin: Ein Server mit quantity_delta zählt zwei Geräte zusammen,
     * einer ohne nimmt die Menge — dann gewinnt wie früher der Letzte.
     */
    data class TeilAendern(val partNumber: String, val colorId: Int, val anfrage: UpdateManualItemRequest,
                           val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    /** Löschen wartet wie jede Änderung; was der Server schon nicht mehr kennt, gilt als gelöscht. */
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    data class FigurErfassen(val anfrage: AddMinifigRequest) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = anfrage.figNumber
    }

    data class FigurAendern(val figNumber: String, val anfrage: UpdateManualItemRequest,
                            val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }

    data class FigurLoeschen(val figNumber: String, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }
}
