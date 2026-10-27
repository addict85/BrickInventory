package ch.brickinventoryapp.ui.screens

import kotlin.math.roundToInt

// Die Rechnung, mit der ein Zoomschritt den Punkt zwischen den Fingern
// festhaelt. Ohne Compose, damit sie ohne Geraet geprueft werden kann
// (PdfZoomTest); PdfPages fuettert sie mit dem Layout der letzten Messung.

/** Eine sichtbare Seite: oberer Rand im Sichtfeld und Hoehe, in Pixeln. */
internal data class SeitenLage(val index: Int, val oben: Int, val hoehe: Int)

/**
 * Wohin die Liste nach einem Zoom um den Faktor [f] rollt, damit der Punkt auf
 * Hoehe [ankerY] des Sichtfelds stehen bleibt. Die Seiten wachsen mit dem
 * Faktor, Rand und Abstaende nicht.
 * @return erste Seite und Versatz fuer scrollToItem; null ohne sichtbare Seite
 */
internal fun zoomZielY(
    seiten: List<SeitenLage>, ankerY: Float, f: Float, randOben: Int, abstand: Int,
): Pair<Int, Int>? {
    val unter = seiten.lastOrNull { it.oben <= ankerY } ?: seiten.firstOrNull() ?: return null
    val d = ankerY - unter.oben
    val dNeu = when {
        d < 0f -> d
        d <= unter.hoehe -> d * f
        else -> unter.hoehe * f + (d - unter.hoehe)
    }
    // Liegt die Seite nach dem Schritt unterhalb der Oberkante, beginnt die
    // Liste mit einer frueheren; deren Hoehe kennt die Messung meist schon.
    val hoehen = seiten.associate { it.index to it.hoehe }
    var index = unter.index
    var versatz = randOben - ankerY + dNeu
    while (versatz < 0f && index > 0) {
        index--
        versatz += (hoehen[index] ?: unter.hoehe) * f + abstand
    }
    return index to versatz.roundToInt().coerceAtLeast(0)
}

/**
 * Die waagerechte Rollposition, bei der der Punkt [ankerX] des Sichtfelds
 * stehen bleibt. [rand] ist der feste Rand links der Seiten.
 */
internal fun zoomZielX(scroll: Int, ankerX: Float, rand: Float, f: Float): Int =
    (rand + (scroll + ankerX - rand) * f - ankerX).roundToInt().coerceAtLeast(0)
