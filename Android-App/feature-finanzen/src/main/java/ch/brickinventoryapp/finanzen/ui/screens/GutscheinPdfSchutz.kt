package ch.brickinventoryapp.finanzen.ui.screens

import androidx.compose.runtime.Composable
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.finanzen.ui.viewmodel.zeigtGutscheine

/** Ein Gutschein-PDF trägt Nummer und PIN: kein Bildschirmfoto, solange es angezeigt wird. */
@Composable
internal fun GutscheinPdfSchutz(pdfUrl: String) {
    if (zeigtGutscheine(pdfUrl)) Sichtschutz()
}
