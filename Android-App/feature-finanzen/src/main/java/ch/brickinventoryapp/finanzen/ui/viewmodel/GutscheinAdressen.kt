package ch.brickinventoryapp.finanzen.ui.viewmodel

import ch.brickinventoryapp.finanzen.ui.VoucherPdfTarget

/**
 * Die Adressen für den vorhandenen PDF-Betrachter. Er lädt sie mit dem
 * angemeldeten Client; eine eigene Kopie im Cache des Geräts wäre ein zweiter
 * Ort für Nummer und PIN, der das Abmelden überlebt. Das [ticket] kommt aus
 * VouchersRepository.pdfRelease() und gilt für einen Abruf.
 */
internal fun voucherPdfAddress(serverUrl: String, id: Int, ticket: String? = null): String =
    withTicket(serverUrl.trimEnd('/') + "/api/v1/vouchers/" + id + "/pdf", ticket)

internal fun voucherExportAddress(serverUrl: String, ticket: String? = null): String =
    withTicket(serverUrl.trimEnd('/') + "/api/v1/vouchers/export/pdf", ticket)

internal fun voucherPdfAddress(serverUrl: String, ziel: VoucherPdfTarget): String =
    if (ziel.id == null) voucherExportAddress(serverUrl, ziel.ticket) else voucherPdfAddress(serverUrl, ziel.id, ziel.ticket)

/** Trägt die Adresse ein Ticket? Dann lädt der Betrachter in einem Zug, ohne Wiederholung. */
internal fun pdfWithOnceTicket(pdfUrl: String): Boolean =
    runCatching { java.net.URI(pdfUrl.trim()).rawQuery }.getOrNull()
        ?.split('&')?.any { it.substringBefore('=') == "ticket" } == true

private fun withTicket(adresse: String, ticket: String?): String =
    if (ticket == null) adresse else adresse + "?ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8")

/**
 * Zeigt der Betrachter Nummer und PIN eines Gutscheins? Dann gilt derselbe
 * Sichtschutz wie auf der Gutscheinseite (ui/components/Sichtschutz.kt). Am
 * Pfad, nicht als Teilstring: Express nimmt `/API/v1/Vouchers` und `%76ouchers`
 * genauso; was sich nicht lesen lässt, gilt als vertraulich.
 */
internal fun showsVouchers(pdfUrl: String): Boolean {
    val pfad = runCatching { java.net.URI(pdfUrl.trim()).path }.getOrNull() ?: return true
    val teile = pfad.split('/').filter { it.isNotEmpty() }.map { it.lowercase() }
    return teile.windowed(3).any { it == listOf("api", "v1", "vouchers") }
}

/**
 * Bietet der Betrachter „Herunterladen“ an? Nicht für Gutscheine: Der Knopf legt
 * die Datei in den öffentlichen Download-Ordner, den jede App mit Speicherzugriff
 * liest und der das Abmelden überlebt — für Nummer und PIN der falsche Ort.
 */
internal fun pdfMaySavedBecome(pdfUrl: String): Boolean = !showsVouchers(pdfUrl)
