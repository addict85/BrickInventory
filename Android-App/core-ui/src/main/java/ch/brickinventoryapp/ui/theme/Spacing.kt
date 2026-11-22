package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.unit.dp

/**
 * The app's spacing scale — so spacing values have a name instead of standing as bare
 * numbers in the screens, like the web app's CSS classes.
 */
object Spacing {
    /** Haarfein — Trennlinien, dicht gesetzte Plaketten. */
    val hairline = 2.dp

    /** The smallest spacing that still reads as spacing. */
    val tiny = 4.dp

    /** The app's most common spacing: between siblings in a row. */
    val small = 8.dp

    /** Zwischen Gruppen innerhalb einer Karte. */
    val medium = 12.dp

    /** The inner padding of a card, the margin of a list. */
    val large = 16.dp

    /** Zwischen Abschnitten eines Bildschirms. */
    val veryLarge = 24.dp

    /** Before and after whatever should stand alone. */
    val huge = 32.dp

    /**
     * The screens' side margin — 14 dp. Not a spacing between things, but the edge
     * where a page begins; it appears many times across the tree (ScopeFilterRow, search field,
     * chip rows), and pulling it to 16 would be a design change at all of these
     * spots.
     */
    val edge = 14.dp
}
