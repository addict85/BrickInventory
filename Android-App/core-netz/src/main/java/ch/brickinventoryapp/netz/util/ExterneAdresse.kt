package ch.brickinventoryapp.netz.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * What may go to a foreign app (browser): https only. The addresses come from
 * server data (instructions, purchase links); an `intent:`, `file:` or
 * `content:` in there would otherwise open arbitrary targets on the device.
 * The app opens its own server itself, so no http is needed here.
 */
fun externeAdresse(url: String?): String? =
    url?.trim()?.toHttpUrlOrNull()?.takeIf { it.isHttps }?.toString()

/**
 * A path on our own server as a full address — resolved rather than concatenated,
 * and only if it stays on the same server and under its own subpath:
 * `//fremd.example/x`, `../andere-app/x` or a full address in `local_path`
 * would otherwise lead the token client to a foreign application.
 */
fun eigeneAdresse(serverUrl: String, pfad: String): String? {
    val basis = (serverUrl.trim().trimEnd('/') + "/").toHttpUrlOrNull() ?: return null
    val ziel = basis.resolve(pfad.trim().removePrefix("/")) ?: return null
    return ziel.takeIf { it.scheme == basis.scheme && it.host == basis.host && it.port == basis.port &&
        NetworkPolicy.imBasisPfad(it, serverUrl) }?.toString()
}

/**
 * Does the in-app viewer load this address? Only from our own server: it loads
 * with the token client. Rendering happens in isolation (PdfRenderDienst), but
 * loading happens here. The system opens foreign PDFs (oeffneExtern), as SetDetailSections does.
 */
fun pdfImBetrachter(pdfUrl: String, serverUrl: String): Boolean {
    val ziel = pdfUrl.trim().toHttpUrlOrNull() ?: return false
    return serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, serverUrl) && NetworkPolicy.imBasisPfad(ziel, serverUrl)
}
