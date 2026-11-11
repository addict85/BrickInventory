package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Die eine Regel für breite Fenster, damit Raster, Listen und Werkzeugleisten nicht je eigen
 * ausgerichtet sind: Raster nutzen die volle Breite, Liste und Detail stehen ab „expanded“
 * nebeneinander, Formulare mittig auf ihrer Lesebreite.
 */
object Lesebreite {
    /** Formulare: Anmelden, Einrichten, Einstellungen, „Mehr“. */
    val formular = 560.dp

    /** Unterseiten mit Zeilen aus Bezeichnung und Wert. */
    val liste = 840.dp

    /**
     * Eine Zeile aus Bezeichnung und Wert in einer Detailkarte. Über die ganze Tablet-
     * spalte gezogen, lagen 500 dp zwischen „Jahr“ und „2022“, und das Auge verlor die Zeile.
     */
    val wertzeile = 440.dp

    /** Knöpfe und Eingabefelder in Detailkarten: Mit Telefon-Proportionen über 900 dp wirkten sie unfertig. */
    val bedienung = 400.dp
}

/** Volle Breite bis [max], darüber mittig. */
fun Modifier.mittigBis(max: Dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()
