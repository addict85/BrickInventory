package ch.brickinventoryapp.ui

/** Wo die Reiter stehen: unten am Telefon, links als Seitenleiste auf breiten Fenstern. */
enum class NavigationMode { LEISTE_UNTEN, SIDEBAR }

/**
 * Ab der Material-Breitenklasse „medium" (600 dp) stehen die Reiter links:
 * Eine untere Leiste über die ganze Tablet-Breite zieht fünf Ziele weit
 * auseinander. Ohne Android-Klassen, damit die Schwelle prüfbar ist.
 */
fun navigationMode(windowWidthDp: Float): NavigationMode =
    if (windowWidthDp >= MIDDLE_WIDTH_DP) NavigationMode.SIDEBAR else NavigationMode.LEISTE_UNTEN

/** Untergrenze der Breitenklasse „medium" laut Material Design. */
const val MIDDLE_WIDTH_DP = 600f

/** Untergrenze der Breitenklasse „expanded" laut Material Design. */
const val LARGE_WIDTH_DP = 840f

/**
 * Ab „expanded" stehen Liste und Detail nebeneinander (Material: List-Detail): Das
 * Detail ersetzte auf dem Tablet die Liste, und wer drei Sets verglich, ging dreimal
 * zurück. Gemessen wird das Fenster, nicht das Gerät.
 */
fun listAndDetail(windowWidthDp: Float): Boolean = windowWidthDp >= LARGE_WIDTH_DP

/** Ab „expanded" verteilt sich eine Detailseite auf zwei Spalten. */
fun twoSpaltig(windowWidthDp: Float): Boolean = windowWidthDp >= LARGE_WIDTH_DP
