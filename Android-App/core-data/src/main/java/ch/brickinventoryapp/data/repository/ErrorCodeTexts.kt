package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.resources.R

/**
 * Server error codes with the app's own sentence, for paths without a server sentence:
 * an event stream delivers only status and body for 429, no error with text.
 * Where the server sends a sentence, its sentence applies (AppTexts.meldung); null: no own one.
 */
fun errorTextToCode(code: ErrorCode?): Int? = when (code) {
    ErrorCode.UPLOAD_RUNNING -> R.string.err_upload_running
    ErrorCode.TOO_MANY_CONNECTIONS -> R.string.err_too_many_connections
    ErrorCode.PDF_TOO_MANY_PAGES -> R.string.err_pdf_too_many_pages
    else -> null
}
