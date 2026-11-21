package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.ui.components.focusFrame
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Shapes and elevations in one place, like the colors via `colorScheme`: „make
 * the cards rounder“ should be one line, not fourteen spots. Not attached to
 * `MaterialTheme(shapes = …)`, because that would also reshape every component that
 * currently uses the Material3 default.
 */
object Formen {
    /**
     * The corner radius of the bar, shared by [leiste] and [kachelBildEcken]: the
     * tile image sits flush at the top in the card; different radii would make it
     * stick out or leave a gap.
     */
    private val barRadius = 14.dp

    /** Cards and sections. */
    val karte = RoundedCornerShape(16.dp)
    /** Chips (filter, selection) — the most common shape in the tree. */
    val chip = RoundedCornerShape(20.dp)
    /**
     * Input fields. Buttons have no shape of their own: they all carry the pill of the
     * Material default, so setup, sign-in and dialogs look alike
     * (DesignTokensTest forbids `shape =` on buttons).
     */
    val feld = RoundedCornerShape(12.dp)
    /** Tile images and smaller surfaces. */
    val kachel = RoundedCornerShape(10.dp)
    /** Hint bars and embedded surfaces. */
    val leiste = RoundedCornerShape(barRadius)
    /** Labels and small badges. */
    val etikett = RoundedCornerShape(8.dp)
    /** Very small badges (condition dots, counters). */
    val marke = RoundedCornerShape(6.dp)
    /** Floating action buttons (FAB) in gallery, parts, minifigs. */
    val fab = RoundedCornerShape(18.dp)
    /** Dividers and progress bars — nearly square. */
    val strich = RoundedCornerShape(2.dp)

    /** The top corners of a tile image — must match [leiste]. */
    val kachelBildEcken = RoundedCornerShape(topStart = barRadius, topEnd = barRadius)

    /**
     * Dimensions of an inventory tile (parts and minifig tabs): both show
     * the same grid width, and only here do the numbers live, so none
     * silently drifts.
     */
    val kachelBreite = 112.dp
    /**
     * Height of the inventory tile, computed for the worst case with labelSmall (name
     * on two lines, color, price, note, condition, owner, image): 203 dp. 208 leaves a bit of room;
     * taller, fewer rows would fit on the screen.
     */
    val kachelHoehe  = 208.dp

    /** Erhebung einer flachen Karte (Listen, Abschnitte). */
    val karteErhebung = 1.dp
    /** Erhebung einer hervorgehobenen Karte (Anmeldung, Dialoge, Kennzahlen). */
    val karteErhebungHoch = 2.dp
}

/**
 * The card wrapper — shape, elevation, surface color, full width. The inner padding
 * stays with the caller, because it differed at the call sites.
 */
@Composable
fun AppKarte(
    modifier: Modifier = Modifier,
    /**
     * Make it tappable. Material3 has its own `Card` overload for this,
     * with a ripple indicator; a `clickable` on the non-tappable variant would look different.
     */
    onClick: (() -> Unit)? = null,
    /** What tapping does, for TalkBack („Double-tap to open details“). */
    onClickLabel: String? = null,
    inhalt: @Composable ColumnScope.() -> Unit
) {
    val form = Formen.karte
    val survey = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
    val farben = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    if (onClick == null) {
        Card(modifier = modifier.fillMaxWidth(), shape = form,
             elevation = survey, colors = farben, content = inhalt)
    } else {
        // Card(onClick) sets no role; TalkBack didn't announce the tile as a button.
        val controls = Modifier.focusFrame(form).semantics {
            role = Role.Button
            onClick(label = onClickLabel) { onClick(); true }
        }
        Card(onClick = onClick, modifier = modifier.fillMaxWidth().then(controls), shape = form,
             elevation = survey, colors = farben, content = inhalt)
    }
}

/**
 * Colors with meaning that the Material scheme doesn't know („success“,
 * „warning“) — defined once instead of scattered, so they follow along with the
 * theme. The values per theme live in statusColorsFor() in Theme.kt.
 */
data class StatusFarben(
    val erfolg: Color,
    val warnung: Color,
    val fehler: Color,
)

val LocalStatusFarben = staticCompositionLocalOf {
    StatusFarben(
        erfolg  = Color(0xFF166534),
        warnung = Color(0xFFE3B341),
        fehler  = Color(0xFFB91C1C),
    )
}
