package ch.brickinventoryapp.finanzen.ui.screens

import kotlin.math.roundToInt

// Die Rechnung, mit der ein Zoomschritt den Punkt zwischen den Fingern
// festhaelt. Ohne Compose, damit sie ohne Geraet geprueft werden kann;
// PdfPages fuettert sie mit dem Layout der letzten Messung.

/** Eine sichtbare Seite: oberer Rand im Sichtfeld und Hoehe, in Pixeln. */
internal data class PagesSituation(val index: Int, val oben: Int, val hoehe: Int)

/**
 * Wohin die Liste nach einem Zoom um den Faktor [f] rollt, damit der Punkt auf
 * Hoehe [anchorY] des Sichtfelds stehen bleibt. Die Seiten wachsen mit dem
 * Faktor, Rand und Abstaende nicht.
 * @return erste Seite und Versatz fuer scrollToItem; null ohne sichtbare Seite
 */
internal fun zoomZielY(
    pages: List<PagesSituation>, anchorY: Float, f: Float, edgeTop: Int, abstand: Int,
): Pair<Int, Int>? {
    val unter = pages.lastOrNull { it.oben <= anchorY } ?: pages.firstOrNull() ?: return null
    val d = anchorY - unter.oben
    val dNew = when {
        d < 0f -> d
        d <= unter.hoehe -> d * f
        else -> unter.hoehe * f + (d - unter.hoehe)
    }
    // Liegt die Seite nach dem Schritt unterhalb der Oberkante, beginnt die
    // Liste mit einer frueheren; deren Hoehe kennt die Messung meist schon.
    val heights = pages.associate { it.index to it.hoehe }
    var index = unter.index
    var versatz = edgeTop - anchorY + dNew
    while (versatz < 0f && index > 0) {
        index--
        versatz += (heights[index] ?: unter.hoehe) * f + abstand
    }
    return index to versatz.roundToInt().coerceAtLeast(0)
}

/**
 * Die waagerechte Rollposition, bei der der Punkt [anchorX] des Sichtfelds
 * stehen bleibt. [edge] ist der feste Rand links der Seiten.
 */
internal fun zoomZielX(scroll: Int, anchorX: Float, edge: Float, f: Float): Int =
    (edge + (scroll + anchorX - edge) * f - anchorX).roundToInt().coerceAtLeast(0)
