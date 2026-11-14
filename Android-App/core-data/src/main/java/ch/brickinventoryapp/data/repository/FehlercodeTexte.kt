package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.vertrag.Fehlercode
import ch.brickinventoryapp.ressourcen.R

/**
 * Fehlercodes des Servers mit eigenem Satz der App, für Wege ohne Satz des Servers:
 * Ein Ereignisstrom liefert bei 429 nur Status und Rumpf, keinen Fehler mit Text.
 * Wo der Server einen Satz schickt, gilt seiner (AppTexte.meldung); null: kein eigener.
 */
fun fehlerTextZuCode(code: Fehlercode?): Int? = when (code) {
    Fehlercode.UPLOAD_LAEUFT -> R.string.err_upload_laeuft
    Fehlercode.ZU_VIELE_VERBINDUNGEN -> R.string.err_zu_viele_verbindungen
    Fehlercode.PDF_ZU_VIELE_SEITEN -> R.string.err_pdf_zu_viele_seiten
    else -> null
}
