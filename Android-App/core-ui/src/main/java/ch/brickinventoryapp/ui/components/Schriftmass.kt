package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp

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
