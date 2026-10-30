package ch.brickinventoryapp.ui.viewmodel

/**
 * Die Adressen für den vorhandenen PDF-Betrachter. Er lädt sie mit dem
 * angemeldeten Client; eine eigene Kopie im Cache des Geräts wäre ein zweiter
 * Ort für Nummer und PIN, der das Abmelden überlebt.
 */
internal fun gutscheinPdfAdresse(serverUrl: String, id: Int): String =
    serverUrl.trimEnd('/') + "/api/v1/vouchers/" + id + "/pdf"

internal fun gutscheinExportAdresse(serverUrl: String): String =
    serverUrl.trimEnd('/') + "/api/v1/vouchers/export/pdf"

/**
 * Zeigt der Betrachter Nummer und PIN eines Gutscheins? Dann gilt derselbe
 * Sichtschutz wie auf der Gutscheinseite (ui/components/Sichtschutz.kt).
 */
fun zeigtGutscheine(pdfUrl: String): Boolean = "/api/v1/vouchers/" in pdfUrl
