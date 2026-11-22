package ch.brickinventoryapp.network.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * What may go to a foreign app (browser): https only. The addresses come from
 * server data (instructions, purchase links); an `intent:`, `file:` or
 * `content:` in there would otherwise open arbitrary targets on the device.
 * The app opens its own server itself, so no http is needed here.
 */
fun externalAddress(url: String?): String? =
    url?.trim()?.toHttpUrlOrNull()?.takeIf { it.isHttps }?.toString()

/**
 * A path on our own server as a full address — resolved rather than concatenated,
 * and only if it stays on the same server and under its own subpath:
 * `//foreign.example/x`, `../other-app/x` or a full address in `local_path`
 * would otherwise lead the token client to a foreign application.
 */
fun ownAddress(serverUrl: String, path: String): String? {
    val basis = (serverUrl.trim().trimEnd('/') + "/").toHttpUrlOrNull() ?: return null
    val target = basis.resolve(path.trim().removePrefix("/")) ?: return null
    return target.takeIf { it.scheme == basis.scheme && it.host == basis.host && it.port == basis.port &&
        NetworkPolicy.inBasePath(it, serverUrl) }?.toString()
}

/**
 * Does the in-app viewer load this address? Only from our own server: it loads
 * with the token client. Rendering happens in isolation (PdfRenderService), but
 * loading happens here. The system opens foreign PDFs (openExtern), as SetDetailSections does.
 */
fun pdfInViewer(pdfUrl: String, serverUrl: String): Boolean {
    val target = pdfUrl.trim().toHttpUrlOrNull() ?: return false
    return serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(target, serverUrl) && NetworkPolicy.inBasePath(target, serverUrl)
}
