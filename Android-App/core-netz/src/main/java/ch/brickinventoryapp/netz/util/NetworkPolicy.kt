package ch.brickinventoryapp.netz.util

import ch.brickinventoryapp.core.netz.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/**
 * The guard's network rules. A token only goes to the same origin (scheme,
 * host, port), never by string prefix. There is no plain text: only a debug
 * build may reach the device itself and the emulator host, as its own
 * network-security-config allows.
 */
object NetworkPolicy {

    /** Same origin: scheme, host and (effective) port must match. */
    fun isSameOrigin(url: HttpUrl, serverUrl: String): Boolean {
        val base = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return false
        return url.scheme.equals(base.scheme, ignoreCase = true) &&
            url.host.equals(base.host, ignoreCase = true) &&
            url.port == base.port
    }

    /**
     * The hosts a debug build may reach over http. The same three are listed in
     * app/src/debug/res/xml/network_security_config.xml; the release build has
     * no exception.
     */
    val ENTWICKLUNGS_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")

    /** A debug build? Callers on the device read this value; tests set it explicitly. */
    val entwicklung: Boolean get() = BuildConfig.DEBUG

    /** May this request go out? https always, http only in a debug build to [ENTWICKLUNGS_HOSTS]. */
    fun verbindungErlaubt(url: HttpUrl, entwicklung: Boolean): Boolean =
        url.isHttps || (entwicklung && url.host.lowercase() in ENTWICKLUNGS_HOSTS)

    /**
     * Why setup won't accept an address. BENUTZERANGABE and ZUSATZ: `a@b`, line
     * breaks, `\`, `?` or `#` can make an address look like it points at one
     * server and lead to another; a server address needs none of that.
     */
    enum class Adressfehler { UNLESBAR, KLARTEXT, BENUTZERANGABE, ZUSATZ }

    /** Input without a scheme counts as https: "nas.fritz.box" means https://nas.fritz.box. */
    fun normalisiere(eingabe: String): String {
        val t = eingabe.trim()
        return (if (t.isEmpty() || t.contains("://")) t else "https://$t").trimEnd('/')
    }

    /** Null means: setup accepts the address. Whitespace at the edge carries manual input through. */
    fun adressfehler(serverUrl: String, entwicklung: Boolean): Adressfehler? {
        val roh = normalisiere(serverUrl)
        if (roh.any { it.isWhitespace() || it.isISOControl() || it == '\\' }) return Adressfehler.ZUSATZ
        val url = roh.toHttpUrlOrNull() ?: return Adressfehler.UNLESBAR
        val autoritaet = roh.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#')
        if ('@' in autoritaet || url.username.isNotEmpty() || url.password.isNotEmpty()) return Adressfehler.BENUTZERANGABE
        if (url.query != null || url.fragment != null) return Adressfehler.ZUSATZ
        return if (verbindungErlaubt(url, entwicklung)) null else Adressfehler.KLARTEXT
    }

    /**
     * What the app understands under an address, for confirmation: host in
     * ASCII (punycode), because a Cyrillic "і" is indistinguishable from "i" in
     * the Unicode rendering. [international]: the host contains an `xn--` label.
     */
    data class Adressansicht(val host: String, val adresse: String, val international: Boolean)

    fun ansicht(serverUrl: String): Adressansicht? {
        val url = normalisiere(serverUrl).toHttpUrlOrNull() ?: return null
        val host = if (':' in url.host) "[${url.host}]" else url.host
        val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
        val pfad = url.encodedPath.trimEnd('/')
        return Adressansicht(host, "${url.scheme}://$host$port$pfad", url.host.split('.').any { it.startsWith("xn--") })
    }

    /**
     * A stored http address from before the plain-text ban. The app then goes
     * to setup and explains the move to https, instead of failing on the first
     * request with a network error.
     */
    fun klartextAltbestand(serverUrl: String, entwicklung: Boolean): Boolean =
        adressfehler(serverUrl, entwicklung) == Adressfehler.KLARTEXT

    /** Is the address encrypted? Only then does the app offer a token without expiry. */
    fun istHttps(serverUrl: String): Boolean = serverUrl.trim().toHttpUrlOrNull()?.isHttps == true

    /**
     * Scheme, host and port as one text — the origin a token is bound to. A
     * token is only valid for the server that issued it.
     */
    fun herkunft(serverUrl: String): String? {
        val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
        return "${url.scheme}://${url.host.lowercase()}:${url.port}"
    }

    /** Both addresses point at the same server; an empty one points at none. */
    fun gleicheHerkunft(a: String, b: String): Boolean {
        val ha = herkunft(a) ?: return false
        return ha == herkunft(b)
    }

    /** The server's path behind a proxy ("/brick"), without a trailing slash; "" without a prefix. */
    fun basisPfad(serverUrl: String): String? =
        serverUrl.trim().trimEnd('/').toHttpUrlOrNull()?.encodedPath?.trimEnd('/')

    /**
     * Does [url] lie under the server's path? If several applications share a
     * host, the token belongs only to this one; segment-wise, `/brick` does not
     * cover `/brickfremd`.
     */
    fun imBasisPfad(url: HttpUrl, serverUrl: String): Boolean {
        val basis = basisPfad(serverUrl) ?: return false
        return basis.isEmpty() || url.encodedPath == basis || url.encodedPath.startsWith("$basis/")
    }

    /** The same server: origin and path. A different path on the same host is a different application. */
    fun gleicherServer(a: String, b: String): Boolean =
        gleicheHerkunft(a, b) && basisPfad(a) == basisPfad(b)
}

/**
 * A request without TLS that the guard does not send. Its own type, so the
 * data layer turns it into a message with guidance instead of "network error".
 */
class KlartextAbgelehnt(val host: String) :
    IOException("Unverschlüsselte Verbindung zu $host abgelehnt: Die App spricht nur https.")
