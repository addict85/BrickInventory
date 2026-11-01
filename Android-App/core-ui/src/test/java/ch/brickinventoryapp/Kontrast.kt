package ch.brickinventoryapp

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Kontrastverhältnis nach WCAG 2 (1:1 bis 21:1) für Farbprüfungen in Tests;
 * Alpha wird ignoriert. Ohne Compose-Klassen, damit die Rechnung selbst
 * geprüft werden kann (KontrastTest).
 */
object Kontrast {

    /** Mindestkontrast für Grenzen von Bedienelementen (WCAG 1.4.11). */
    const val RAHMEN = 3.0

    fun verhaeltnis(argbA: Int, argbB: Int): Double {
        val a = luminanz(argbA)
        val b = luminanz(argbB)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /** Relative Leuchtdichte einer sRGB-Farbe (0 = schwarz, 1 = weiss). */
    fun luminanz(argb: Int): Double {
        fun kanal(wert: Int): Double {
            val c = wert / 255.0
            return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * kanal((argb shr 16) and 0xFF) +
            0.7152 * kanal((argb shr 8) and 0xFF) +
            0.0722 * kanal(argb and 0xFF)
    }
}
