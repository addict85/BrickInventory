package ch.brickinventoryapp.nav

import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavType
import androidx.navigation.navArgument
import ch.brickinventoryapp.data.model.KEINE_FARBE

// Die Argumente der Routen mit Werten im Pfad stehen hier einmal, damit Graph und
// RoutenRundwegTest dieselben Listen und dieselben Leser benutzen.

internal val setArgumente = listOf(
    navArgument("setNumber") { type = NavType.StringType },
)

internal val merkpostenArgumente = listOf(
    navArgument("setNumber") { type = NavType.StringType },
    navArgument("condition") { type = NavType.StringType },
)

/** ManualItemDetail und AcquisitionManagement haben dasselbe Muster. */
internal val einzelstueckArgumente = listOf(
    navArgument("type") { type = NavType.StringType },
    navArgument("id") { type = NavType.StringType },
    navArgument("colorId") { type = NavType.IntType; defaultValue = KEINE_FARBE },
    navArgument("title") { type = NavType.StringType },
)

internal val pdfArgumente = listOf(
    navArgument("url") { type = NavType.StringType },
    navArgument("title") { type = NavType.StringType },
)

/**
 * Ein Text-Argument so, wie Navigation es aus dem Pfad gelesen hat. Navigation hat es
 * schon dekodiert; ein zweites Dekodieren machte aus „100 %“ einen Absturz, aus „C++“
 * „C  “ und aus `%20` in einer PDF-Adresse ein Leerzeichen.
 */
internal fun NavBackStackEntry.textArgument(name: String, ersatz: String = ""): String =
    arguments?.getString(name) ?: ersatz

internal fun NavBackStackEntry.farbArgument(): Int =
    arguments?.getInt("colorId") ?: KEINE_FARBE
