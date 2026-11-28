package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The one rule for wide windows, so grids, lists and toolbars aren't each
 * aligned on their own: grids use the full width, list and detail sit side by
 * side from „expanded“ onward, forms are centered at their reading width.
 */
object ReadingWidth {
    /** Formulare: Anmelden, Einrichten, Einstellungen, „Mehr“. */
    val form = 560.dp

    /** Sub-pages with rows of label and value. */
    val list = 840.dp

    /**
     * A row of label and value in a detail card. Stretched across the whole tablet
     * column, 500 dp sat between „Jahr“ and „2022“, and the eye lost the row.
     */
    val valueRow = 440.dp

    /** Search fields above grids and lists ([searchFieldWidth][ch.brickinventoryapp.ui.components.searchFieldWidth]). */
    val search = 720.dp

    /** Buttons and input fields in detail cards: with phone proportions beyond 900 dp, they looked unfinished. */
    val controls = 400.dp
}

/** Full width up to [max], centered above that. */
fun Modifier.centeredUntil(max: Dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()
