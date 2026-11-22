package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.ui.TabTarget
import kotlinx.serialization.Serializable

/** The destinations of parts and minifigures. */
@Serializable
sealed interface PartsTarget {
    @Serializable data object Parts : PartsTarget, TabTarget {
        override val rollKey get() = "parts"
    }
    @Serializable data object Minifigs : PartsTarget, TabTarget {
        override val rollKey get() = "minifigs"
    }
    @Serializable data object PartsList : PartsTarget

    /** Detail of a manually entered part or figure. */
    @Serializable data class ManualItemDetail(
        val kind: ItemKind,
        val id: String,
        val colorId: Int = NO_COLOR,
        val title: String,
    ) : PartsTarget
}
