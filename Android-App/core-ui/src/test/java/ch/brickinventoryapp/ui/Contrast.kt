package ch.brickinventoryapp.ui

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Contrast ratio per WCAG 2 (1:1 to 21:1) for color checks in tests;
 * alpha is ignored. Without Compose classes, so the calculation itself
 * can be checked (ContrastTest).
 */
object Contrast {

    /** Minimum contrast for control borders (WCAG 1.4.11). */
    const val FRAME = 3.0

    fun ratio(argbA: Int, argbB: Int): Double {
        val a = luminance(argbA)
        val b = luminance(argbB)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /** Relative luminance of an sRGB color (0 = black, 1 = white). */
    fun luminance(argb: Int): Double {
        fun channel(value: Int): Double {
            val c = value / 255.0
            return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel((argb shr 16) and 0xFF) +
            0.7152 * channel((argb shr 8) and 0xFF) +
            0.0722 * channel(argb and 0xFF)
    }
}
