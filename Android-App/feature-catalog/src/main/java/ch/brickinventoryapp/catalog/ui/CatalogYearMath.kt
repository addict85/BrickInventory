package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.model.domain.YearCountView
import kotlin.math.roundToInt

/**
 * Pure math of the year bar (CatalogScreen) — its own object, so it's
 * checkable in JUnit without Compose.
 */
internal object CatalogYearMath {

    /**
     * Fraction (0..1) along the bar for a touch at y pixels. As in the web app
     * (`js/rollbalken.js` → `rollen`): the handle sits centered under the finger,
     * converted onto the track without the handle's height.
     */
    fun shareFrom(y: Float, heightPx: Int, thumbHeightPx: Int): Float {
        val track = (heightPx - thumbHeightPx).coerceAtLeast(1)
        return ((y - thumbHeightPx / 2f) / track).coerceIn(0f, 1f)
    }

    /** Vertical offset (pixels) of the handle's top edge for a fraction. */
    fun thumbOffset(share: Float, heightPx: Int, thumbHeightPx: Int): Int =
        (share.coerceIn(0f, 1f) * (heightPx - thumbHeightPx).coerceAtLeast(0)).roundToInt()

    /** Running number in the total result for a fraction. */
    fun numberFrom(share: Float, total: Int): Int {
        if (total <= 0) return 0
        return (share.coerceIn(0f, 1f) * (total - 1)).roundToInt()
    }

    /** Fraction for a running number — the reverse direction of numberFrom. */
    fun shareFromNumber(number: Int, total: Int): Float {
        if (total <= 1) return 0f
        return (number.toFloat() / (total - 1)).coerceIn(0f, 1f)
    }

    /**
     * The year that stands next to the handle — in the same order as the web app
     * (`js/katalog.js` → _jahrAnPosition):
     *
     *   First choice:  the year of the tile at that spot. If it's loaded, that's the truth, not a calculation.
     *   Second choice: the distribution, for still-empty areas.
     *
     * @param loaded delivers the year for a running number, or null if that
     *         spot isn't loaded yet
     */
    fun yearFor(
        share: Float, total: Int, distribution: List<YearCountView>,
        loaded: (Int) -> Int?
    ): Int? = loaded(numberFrom(share, total)) ?: yearAnPosition(share, total, distribution)

    /**
     * Which year sits at this fraction of the list? As in the web app
     * (`js/katalog.js` → _jahrAnPosition): a fraction becomes a running number,
     * which walks through the distribution until it falls into a year.
     */
    fun yearAnPosition(share: Float, total: Int, distribution: List<YearCountView>): Int? {
        if (distribution.isEmpty() || total <= 0) return null
        var number = numberFrom(share, total)
        for (entry in distribution) {
            if (number < entry.n) return entry.year
            number -= entry.n
        }
        return distribution.last().year
    }

    /** The first running number of a year; null if the distribution doesn't know it. */
    fun numberOfYear(year: Int, distribution: List<YearCountView>): Int? {
        var number = 0
        for (entry in distribution) {
            if (entry.year == year) return number
            number += entry.n
        }
        return null
    }
}
