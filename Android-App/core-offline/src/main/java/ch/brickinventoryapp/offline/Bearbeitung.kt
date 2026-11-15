package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand

/**
 * Eine Änderung, die ohne Verbindung im Ausgang wartet, in Fachwerten; die Anfrage daraus
 * baut erst core-data beim Senden. Mengen von Sets gehen als Schritt, damit zwei Geräte
 * zusammen +2 ergeben. Auf der Platte liegt sie als [Ausgangsform].
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

    data class SetErfassen(val wunsch: Erfassungswunsch) : Bearbeitung() {
        override val art get() = Bestandsart.SETS
        override val ziel get() = wunsch.setNumber
    }

    data class MerkpostenAnlegen(val wunsch: Merkwunsch) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = wunsch.setNumber
    }

    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MERKLISTE
        override val ziel get() = setNumber
    }

    data class TeilErfassen(val erfassung: Teilerfassung) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = erfassung.nummer
    }

    /** Die Änderung trägt die neue Menge und, wenn die bisherige bekannt war, den Schritt dorthin. */
    data class TeilAendern(val partNumber: String, val colorId: Int, val aenderung: Stueckaenderung,
                           val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    /** Löschen wartet wie jede Änderung; was der Server schon nicht mehr kennt, gilt als gelöscht. */
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    data class FigurErfassen(val erfassung: Figurenerfassung) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = erfassung.nummer
    }

    data class FigurAendern(val figNumber: String, val aenderung: Stueckaenderung,
                            val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }

    data class FigurLoeschen(val figNumber: String, val besitzer: Int?) : Bearbeitung() {
        override val art get() = Bestandsart.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }
}
