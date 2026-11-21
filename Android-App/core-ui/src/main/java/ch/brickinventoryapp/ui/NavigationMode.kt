package ch.brickinventoryapp.ui

/** Where the tabs sit: at the bottom on the phone, as a side rail on wide windows. */
enum class NavigationMode { LEISTE_UNTEN, SIDEBAR }

/**
 * From the Material width class „medium" (600 dp) onward, the tabs sit on the left:
 * a bottom bar across the whole tablet width pulls five destinations far
 * apart. Without Android classes, so the threshold is testable.
 */
fun navigationMode(windowWidthDp: Float): NavigationMode =
    if (windowWidthDp >= MIDDLE_WIDTH_DP) NavigationMode.SIDEBAR else NavigationMode.LEISTE_UNTEN

/** Lower bound of the width class „medium" per Material Design. */
const val MIDDLE_WIDTH_DP = 600f

/** Lower bound of the width class „expanded" per Material Design. */
const val LARGE_WIDTH_DP = 840f

/**
 * From „expanded" onward, list and detail sit side by side (Material: list-detail): the
 * detail used to replace the list on the tablet, and whoever compared three sets went
 * back three times. The window is measured, not the device.
 */
fun listAndDetail(windowWidthDp: Float): Boolean = windowWidthDp >= LARGE_WIDTH_DP

/** From „expanded" onward, a detail page spreads across two columns. */
fun twoSpaltig(windowWidthDp: Float): Boolean = windowWidthDp >= LARGE_WIDTH_DP
