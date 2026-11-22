package ch.brickinventoryapp.update.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Does [url] sit as an APK under [basis]? Parsed and compared segment by segment:
 * a text comparison would let `…/apk-neuste.angreifer.tld/x.apk`, `…/../x.apk` or
 * variants with user info, port or fragment through.
 */
internal fun liesBelow(url: String, basis: String): Boolean {
    val ziel = url.toHttpUrlOrNull() ?: return false
    val b = basis.toHttpUrlOrNull() ?: return false
    val folder = b.pathSegments.filter { it.isNotEmpty() }
    return ziel.isHttps && ziel.host == b.host && ziel.port == b.port &&
        ziel.username.isEmpty() && ziel.password.isEmpty() && ziel.query == null && ziel.fragment == null &&
        ziel.pathSegments.size == folder.size + 1 && ziel.pathSegments.take(folder.size) == folder &&
        ziel.pathSegments.last().let { it.endsWith(".apk") && it.length > 4 }
}

/** A package's signature: the current keys and the ancestry (APK signature v3). */
data class Signatur(val aktuell: Set<String>, val ancestors: List<String>)

/**
 * May an APK with [neu] replace the app with [alt]? Like Android: with multiple
 * signers exactly the same ones; with one, the new key may be a successor
 * (key rotation) — then the running one is in the new one's ancestry.
 * Set equality rejected every rotation. Empty means unknown, so no.
 */
internal fun signatureFollows(alt: Signatur, neu: Signatur): Boolean = when {
    alt.aktuell.isEmpty() || neu.aktuell.isEmpty() -> false
    alt.aktuell.size > 1 || neu.aktuell.size > 1 -> alt.aktuell == neu.aktuell
    else -> alt.aktuell == neu.aktuell || alt.aktuell.single() in neu.ancestors
}
