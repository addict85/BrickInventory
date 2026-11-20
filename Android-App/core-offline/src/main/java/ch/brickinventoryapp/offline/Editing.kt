package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand

/**
 * Eine Änderung, die ohne Verbindung im Ausgang wartet, in Fachwerten; die Anfrage daraus
 * baut erst core-data beim Senden. Mengen von Sets gehen als Schritt, damit zwei Geräte
 * zusammen +2 ergeben. Auf der Platte liegt sie als [InitialForm].
 */
sealed class Editing : Offlineablage.Wirkung {
    /** Welche lokale Liste die Änderung betrifft. */
    abstract val art: StockKind

    override val kinds: Set<StockKind> get() = setOf(art)

    /** Wofür die Änderung gilt (Set-, Teile- oder Figurennummer) — für den Hinweis. */
    abstract val ziel: String

    data class SetMenge(val setNumber: String, val schritt: Int) : Editing() {
        override val art get() = StockKind.SETS
        override val ziel get() = setNumber
    }

    data class SetErfassen(val wish: Erfassungswunsch) : Editing() {
        override val art get() = StockKind.SETS
        override val ziel get() = wish.setNumber
    }

    data class MerkpostenAnlegen(val wish: Merkwunsch) : Editing() {
        override val art get() = StockKind.MERKLISTE
        override val ziel get() = wish.setNumber
    }

    data class MerkpostenLoeschen(val setNumber: String, val zustand: Zustand, val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MERKLISTE
        override val ziel get() = setNumber
    }

    data class TeilErfassen(val erfassung: Teilerfassung) : Editing() {
        override val art get() = StockKind.MANUELLE_TEILE
        override val ziel get() = erfassung.nummer
    }

    /** Die Änderung trägt die neue Menge und, wenn die bisherige bekannt war, den Schritt dorthin. */
    data class TeilAendern(val partNumber: String, val colorId: Int, val aenderung: Stueckaenderung,
                           val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    /** Löschen wartet wie jede Änderung; was der Server schon nicht mehr kennt, gilt als gelöscht. */
    data class TeilLoeschen(val partNumber: String, val colorId: Int, val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    data class FigurErfassen(val erfassung: Figurenerfassung) : Editing() {
        override val art get() = StockKind.MANUELLE_FIGUREN
        override val ziel get() = erfassung.nummer
    }

    data class FigurAendern(val figNumber: String, val aenderung: Stueckaenderung,
                            val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }

    data class FigurLoeschen(val figNumber: String, val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MANUELLE_FIGUREN
        override val ziel get() = figNumber
    }
}
