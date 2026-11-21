package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand

/**
 * A change that waits in the outbox without connection, in domain values; the request from it
 * is built only by core-data when sending. Quantities of sets go as a step, so that two devices
 * together give +2. On disk it lies as [InitialForm].
 */
sealed class Editing : Offlineablage.Wirkung {
    /** Which local list the change concerns. */
    abstract val art: StockKind

    override val kinds: Set<StockKind> get() = setOf(art)

    /** What the change applies to (set, part or figure number) — for the hint. */
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

    /** The change carries the new quantity and, if the previous one was known, the step there. */
    data class TeilAendern(val partNumber: String, val colorId: Int, val aenderung: Stueckaenderung,
                           val besitzer: Int?) : Editing() {
        override val art get() = StockKind.MANUELLE_TEILE
        override val ziel get() = partNumber
    }

    /** Deleting waits like every change; what the server no longer knows counts as deleted. */
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
