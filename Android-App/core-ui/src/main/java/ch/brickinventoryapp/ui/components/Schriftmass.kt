package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Ab dieser Schriftgrösse stehen Bezeichnung und Wert untereinander statt
 * nebeneinander: Bei 200 % brach „CHF 700.00“ neben „Kaufpreis“ Ziffer für
 * Ziffer um. 1,3 ist die erste Stufe, die Android über „Gross“ anbietet.
 */
const val GROSSE_SCHRIFT_AB = 1.3f

/** Ist die Schrift so gross, dass Zeilen umgestellt werden ([GROSSE_SCHRIFT_AB])? */
@Composable
fun grosseSchrift(): Boolean = LocalDensity.current.fontScale > GROSSE_SCHRIFT_AB

/**
 * Ein Symbol neben Schrift wächst mit ihr, höchstens aufs Doppelte: Ein Stift von
 * 14 dp neben 32 sp hohem Text war bei 200 % kaum noch zu sehen.
 */
@Composable
fun mitSchrift(basis: Dp): Dp = basis * LocalDensity.current.fontScale.coerceIn(1f, 2f)

/** Ab dieser Rasterbreite gilt ein Fenster als breit (Tablet, Querformat). */
private val BREITES_RASTER = 840.dp

/**
 * Rasterspalten mit [mindestens] als Mindestbreite einer Kachel, gewachsen mit der
 * Schrift (höchstens doppelt) und auf breiten Fenstern um die Hälfte: Bei 200 % kürzte
 * eine 110-dp-Kachel jeden Namen, auf dem Tablet standen kleine Kacheln in einer Ecke.
 */
data class LesbareSpalten(val mindestens: Dp) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> {
        val breit = availableSize.toDp() >= BREITES_RASTER
        val breite = mindestens * fontScale.coerceIn(1f, 2f) * (if (breit) 1.5f else 1f)
        return with(GridCells.Adaptive(breite)) { calculateCrossAxisCellSizes(availableSize, spacing) }
    }
}
