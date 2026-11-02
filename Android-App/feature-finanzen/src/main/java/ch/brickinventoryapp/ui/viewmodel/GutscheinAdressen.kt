package ch.brickinventoryapp.ui.viewmodel

/**
 * Die Adressen für den vorhandenen PDF-Betrachter. Er lädt sie mit dem
 * angemeldeten Client; eine eigene Kopie im Cache des Geräts wäre ein zweiter
 * Ort für Nummer und PIN, der das Abmelden überlebt.
 */
fun gutscheinPdfAdresse(serverUrl: String, id: Int): String =
    serverUrl.trimEnd('/') + "/api/v1/vouchers/" + id + "/pdf"

fun gutscheinExportAdresse(serverUrl: String): String =
    serverUrl.trimEnd('/') + "/api/v1/vouchers/export/pdf"

/**
 * Zeigt der Betrachter Nummer und PIN eines Gutscheins? Dann gilt derselbe
 * Sichtschutz wie auf der Gutscheinseite (ui/components/Sichtschutz.kt). Am
 * Pfad, nicht als Teilstring: Express nimmt `/API/v1/Vouchers` und `%76ouchers`
 * genauso; was sich nicht lesen lässt, gilt als vertraulich.
 */
fun zeigtGutscheine(pdfUrl: String): Boolean {
    val pfad = runCatching { java.net.URI(pdfUrl.trim()).path }.getOrNull() ?: return true
    val teile = pfad.split('/').filter { it.isNotEmpty() }.map { it.lowercase() }
    return teile.windowed(3).any { it == listOf("api", "v1", "vouchers") }
}

/**
 * Bietet der Betrachter „Herunterladen“ an? Nicht für Gutscheine: Der Knopf legt
 * die Datei in den öffentlichen Download-Ordner, den jede App mit Speicherzugriff
 * liest und der das Abmelden überlebt — für Nummer und PIN der falsche Ort.
 */
fun pdfDarfGespeichertWerden(pdfUrl: String): Boolean = !zeigtGutscheine(pdfUrl)
