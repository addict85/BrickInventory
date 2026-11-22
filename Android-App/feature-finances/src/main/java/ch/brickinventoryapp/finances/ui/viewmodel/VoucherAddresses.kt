package ch.brickinventoryapp.finances.ui.viewmodel

import ch.brickinventoryapp.finances.ui.VoucherPdfTarget

/**
 * The addresses for the existing PDF viewer. It loads them with the
 * signed-in client; a copy of its own in the device's cache would be a second
 * place for number and PIN that survives signing out. The [ticket] comes from
 * VouchersRepository.pdfRelease() and is valid for one fetch.
 */
internal fun voucherPdfAddress(serverUrl: String, id: Int, ticket: String? = null): String =
    withTicket(serverUrl.trimEnd('/') + "/api/v1/vouchers/" + id + "/pdf", ticket)

internal fun voucherExportAddress(serverUrl: String, ticket: String? = null): String =
    withTicket(serverUrl.trimEnd('/') + "/api/v1/vouchers/export/pdf", ticket)

internal fun voucherPdfAddress(serverUrl: String, target: VoucherPdfTarget): String =
    if (target.id == null) voucherExportAddress(serverUrl, target.ticket) else voucherPdfAddress(serverUrl, target.id, target.ticket)

/** Does the address carry a ticket? Then the viewer loads in one go, without a retry. */
internal fun pdfWithOnceTicket(pdfUrl: String): Boolean =
    runCatching { java.net.URI(pdfUrl.trim()).rawQuery }.getOrNull()
        ?.split('&')?.any { it.substringBefore('=') == "ticket" } == true

private fun withTicket(address: String, ticket: String?): String =
    if (ticket == null) address else address + "?ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8")

/**
 * Does the viewer show a voucher's number and PIN? Then the same
 * visual protection applies as on the vouchers page (ui/components/PrivacyShield.kt). By
 * path, not as a substring: Express treats `/API/v1/Vouchers` and `%76ouchers`
 * the same; whatever cannot be read counts as confidential.
 */
internal fun showsVouchers(pdfUrl: String): Boolean {
    val path = runCatching { java.net.URI(pdfUrl.trim()).path }.getOrNull() ?: return true
    val parts = path.split('/').filter { it.isNotEmpty() }.map { it.lowercase() }
    return parts.windowed(3).any { it == listOf("api", "v1", "vouchers") }
}

/**
 * Does the viewer offer „Herunterladen“? Not for vouchers: the button puts
 * the file into the public Downloads folder, which every app with storage access
 * reads and which survives signing out — the wrong place for a number and PIN.
 */
internal fun pdfMaySavedBecome(pdfUrl: String): Boolean = !showsVouchers(pdfUrl)
