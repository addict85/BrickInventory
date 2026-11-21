package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.resources.R

/**
 * Server error codes with the app's own sentence, for paths without a server sentence:
 * an event stream delivers only status and body for 429, no error with text.
 * Where the server sends a sentence, its sentence applies (AppTexte.meldung); null: no own one.
 */
fun errorTextToCode(code: Fehlercode?): Int? = when (code) {
    Fehlercode.UPLOAD_LAEUFT -> R.string.err_upload_laeuft
    Fehlercode.ZU_VIELE_VERBINDUNGEN -> R.string.err_zu_viele_verbindungen
    Fehlercode.PDF_ZU_VIELE_SEITEN -> R.string.err_pdf_zu_viele_seiten
    else -> null
}
