package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Wie breit Inhalte höchstens werden. Auf dem Tablet stand das Anmeldeformular
 * 1900 px breit, Bezeichnung und Wert einer Zeile weit auseinander; eine Zeile
 * liest sich nur bis zu einer gewissen Länge.
 */
object Lesebreite {
    /** Formulare: Anmelden, Einrichten, Einstellungen. */
    val formular = 560.dp

    /** Listen und Suchfelder, die über die ganze Fläche liefen. */
    val liste = 840.dp
}

/**
 * Volle Breite bis [max], darüber linksbündig: Für Bedienelemente über einem Raster,
 * das selbst links beginnt — mittig stünden sie versetzt zu den Kacheln darunter.
 */
fun Modifier.linksBis(max: Dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.Start).widthIn(max = max).fillMaxWidth()

/** Volle Breite bis [max], darüber mittig. */
fun Modifier.mittigBis(max: Dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()
