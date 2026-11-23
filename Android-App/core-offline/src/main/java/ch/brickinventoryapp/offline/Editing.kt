package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.local.StockKind

/**
 * A change that waits in the outbox without connection, in domain values; the request from it
 * is built only by core-data when sending. Quantities of sets go as a step, so that two devices
 * together give +2. On disk it lies as [InitialForm].
 */
sealed class Editing : OfflineStore.Effect {
    /** Which local list the change concerns. */
    abstract val kind: StockKind

    override val kinds: Set<StockKind> get() = setOf(kind)

    /** What the change applies to (set, part or figure number) — for the hint. */
    abstract val target: String

    data class SetQuantity(val setNumber: String, val step: Int) : Editing() {
        override val kind get() = StockKind.SETS
        override val target get() = setNumber
    }

    data class RecordSet(val wish: EntryRequest) : Editing() {
        override val kind get() = StockKind.SETS
        override val target get() = wish.setNumber
    }

    data class CreateWantedItem(val wish: WantedRequest) : Editing() {
        override val kind get() = StockKind.WANTED_LIST
        override val target get() = wish.setNumber
    }

    data class DeleteWantedItem(val setNumber: String, val condition: Condition, val owner: Int?) : Editing() {
        override val kind get() = StockKind.WANTED_LIST
        override val target get() = setNumber
    }

    data class RecordPart(val entry: PartEntry) : Editing() {
        override val kind get() = StockKind.MANUAL_PARTS
        override val target get() = entry.number
    }

    /** The change carries the new quantity and, if the previous one was known, the step there. */
    data class EditPart(val partNumber: String, val colorId: Int, val change: QuantityChange,
                           val owner: Int?) : Editing() {
        override val kind get() = StockKind.MANUAL_PARTS
        override val target get() = partNumber
    }

    /** Deleting waits like every change; what the server no longer knows counts as deleted. */
    data class DeletePart(val partNumber: String, val colorId: Int, val owner: Int?) : Editing() {
        override val kind get() = StockKind.MANUAL_PARTS
        override val target get() = partNumber
    }

    data class RecordFigure(val entry: FigureEntry) : Editing() {
        override val kind get() = StockKind.MANUAL_FIGURES
        override val target get() = entry.number
    }

    data class EditFigure(val figNumber: String, val change: QuantityChange,
                            val owner: Int?) : Editing() {
        override val kind get() = StockKind.MANUAL_FIGURES
        override val target get() = figNumber
    }

    data class DeleteFigure(val figNumber: String, val owner: Int?) : Editing() {
        override val kind get() = StockKind.MANUAL_FIGURES
        override val target get() = figNumber
    }
}
