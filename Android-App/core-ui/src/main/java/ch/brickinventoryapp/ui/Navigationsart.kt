package ch.brickinventoryapp.ui

/** Wo die Reiter stehen: unten am Telefon, links als Seitenleiste auf breiten Fenstern. */
enum class Navigationsart { LEISTE_UNTEN, SEITENLEISTE }

/**
 * Ab der Material-Breitenklasse „medium" (600 dp) stehen die Reiter links:
 * Eine untere Leiste über die ganze Tablet-Breite zieht fünf Ziele weit
 * auseinander. Ohne Android-Klassen, damit die Schwelle prüfbar ist.
 */
fun navigationsart(fensterbreiteDp: Float): Navigationsart =
    if (fensterbreiteDp >= MITTLERE_BREITE_DP) Navigationsart.SEITENLEISTE else Navigationsart.LEISTE_UNTEN

/** Untergrenze der Breitenklasse „medium" laut Material Design. */
const val MITTLERE_BREITE_DP = 600f
