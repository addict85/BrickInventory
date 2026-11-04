package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.ressourcen.R

/**
 * Fehlercodes des Servers mit eigenem Satz der App, für Wege ohne Satz des Servers:
 * Ein Ereignisstrom liefert bei 429 nur Status und Rumpf, keinen Fehler mit Text.
 * Wo der Server einen Satz schickt, gilt seiner (AppTexte.meldung); null: kein eigener.
 */
fun fehlerTextZuCode(code: String?): Int? = when (code) {
    "upload_laeuft" -> R.string.err_upload_laeuft
    "zu_viele_verbindungen" -> R.string.err_zu_viele_verbindungen
    "pdf_zu_viele_seiten" -> R.string.err_pdf_zu_viele_seiten
    else -> null
}
