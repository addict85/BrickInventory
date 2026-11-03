package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Die eine Regel für breite Fenster — vorher standen Raster linksbündig, Listen
 * mittig und Werkzeugleisten endeten mitten im Bild:
 *
 *  - Raster (Galerie, Teile, Figuren, Katalog, Merkliste) nutzen die volle Breite;
 *    Such- und Filterleiste sind so breit wie das Raster darunter.
 *  - Liste und Detail stehen ab „expanded“ nebeneinander (ListeUndDetail).
 *  - Formulare und Textseiten stehen mittig auf ihrer Lesebreite ([mittigBis]).
 */
object Lesebreite {
    /** Formulare: Anmelden, Einrichten, Einstellungen, „Mehr“. */
    val formular = 560.dp

    /** Unterseiten mit Zeilen aus Bezeichnung und Wert. */
    val liste = 840.dp
}

/** Volle Breite bis [max], darüber mittig. */
fun Modifier.mittigBis(max: Dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()
