package ch.brickinventoryapp.update.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Does [url] sit as an APK under [basis]? Parsed and compared segment by segment:
 * a text comparison would let `…/apk-neuste.angreifer.tld/x.apk`, `…/../x.apk` or
 * variants with user info, port or fragment through.
 */
internal fun isBelow(url: String, basis: String): Boolean {
    val target = url.toHttpUrlOrNull() ?: return false
    val b = basis.toHttpUrlOrNull() ?: return false
    val folder = b.pathSegments.filter { it.isNotEmpty() }
    return target.isHttps && target.host == b.host && target.port == b.port &&
        target.username.isEmpty() && target.password.isEmpty() && target.query == null && target.fragment == null &&
        target.pathSegments.size == folder.size + 1 && target.pathSegments.take(folder.size) == folder &&
        target.pathSegments.last().let { it.endsWith(".apk") && it.length > 4 }
}

/** A package's signature: the current keys and the ancestry (APK signature v3). */
data class Signature(val current: Set<String>, val ancestors: List<String>)

/**
 * May an APK with [newValue] replace the app with [old]? Like Android: with multiple
 * signers exactly the same ones; with one, the new key may be a successor
 * (key rotation) — then the running one is in the new one's ancestry.
 * Set equality rejected every rotation. Empty means unknown, so no.
 */
internal fun signatureFollows(old: Signature, newValue: Signature): Boolean = when {
    old.current.isEmpty() || newValue.current.isEmpty() -> false
    old.current.size > 1 || newValue.current.size > 1 -> old.current == newValue.current
    else -> old.current == newValue.current || old.current.single() in newValue.ancestors
}
