package ch.brickinventoryapp.util

import ch.brickinventoryapp.core.data.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/**
 * Netzregeln des Wächters. Der Token geht nur an dieselbe Herkunft (Schema,
 * Host, Port), nie per String-Präfix. Klartext gibt es nicht: Nur ein Debug-Build
 * darf zum Gerät selbst und zum Emulator-Host, wie es seine eigene
 * Network-Security-Config erlaubt.
 */
object NetworkPolicy {

    /** Gleiche Herkunft: Scheme, Host und (effektiver) Port müssen übereinstimmen. */
    fun isSameOrigin(url: HttpUrl, serverUrl: String): Boolean {
        val base = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return false
        return url.scheme.equals(base.scheme, ignoreCase = true) &&
            url.host.equals(base.host, ignoreCase = true) &&
            url.port == base.port
    }

    /**
     * Die Hosts, zu denen ein Debug-Build http darf. Dieselben drei stehen in
     * app/src/debug/res/xml/network_security_config.xml; der Release-Build hat
     * keine Ausnahme.
     */
    val ENTWICKLUNGS_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")

    /** Ein Debug-Build? Die Aufrufer im Gerät nehmen diesen Wert, Tests setzen ihn ausdrücklich. */
    val entwicklung: Boolean get() = BuildConfig.DEBUG

    /** Darf diese Anfrage hinaus? https immer, http nur im Debug-Build zu [ENTWICKLUNGS_HOSTS]. */
    fun verbindungErlaubt(url: HttpUrl, entwicklung: Boolean): Boolean =
        url.isHttps || (entwicklung && url.host.lowercase() in ENTWICKLUNGS_HOSTS)

    /**
     * Warum die Einrichtung eine Adresse nicht annimmt. BENUTZERANGABE und ZUSATZ:
     * `a@b`, Zeilenumbrüche, `\`, `?` oder `#` lassen eine Adresse nach einem Server
     * aussehen und zu einem anderen führen; eine Serveradresse braucht nichts davon.
     */
    enum class Adressfehler { UNLESBAR, KLARTEXT, BENUTZERANGABE, ZUSATZ }

    /** Eingabe ohne Schema gilt als https: „nas.fritz.box“ heisst https://nas.fritz.box. */
    fun normalisiere(eingabe: String): String {
        val t = eingabe.trim()
        return (if (t.isEmpty() || t.contains("://")) t else "https://$t").trimEnd('/')
    }

    /** null heisst: Die Einrichtung nimmt die Adresse an. Leerraum am Rand trägt die Eingabe von Hand. */
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
     * Was die App unter einer Adresse versteht, zum Bestätigen: Host in ASCII
     * (Punycode), weil ein kyrillisches „і“ im Unicode-Bild nicht von „i“ zu
     * unterscheiden ist. [international]: Der Host enthält ein `xn--`-Label.
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
     * Eine gespeicherte http-Adresse aus der Zeit vor dem Klartext-Verbot. Die App
     * geht dann in die Einrichtung und erklärt den Weg zu https, statt beim ersten
     * Abruf mit einem Netzfehler zu scheitern.
     */
    fun klartextAltbestand(serverUrl: String, entwicklung: Boolean): Boolean =
        adressfehler(serverUrl, entwicklung) == Adressfehler.KLARTEXT

    /** Ist die Adresse verschlüsselt? Nur dann bietet die App einen Token ohne Ablauf an. */
    fun istHttps(serverUrl: String): Boolean = serverUrl.trim().toHttpUrlOrNull()?.isHttps == true

    /**
     * Schema, Host und Port als ein Text — die Herkunft, an die ein Token
     * gebunden ist. Ein Token gilt nur für den Server, der ihn ausgab.
     */
    fun herkunft(serverUrl: String): String? {
        val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
        return "${url.scheme}://${url.host.lowercase()}:${url.port}"
    }

    /** Beide Adressen zeigen auf denselben Server; eine leere ist keiner. */
    fun gleicheHerkunft(a: String, b: String): Boolean {
        val ha = herkunft(a) ?: return false
        return ha == herkunft(b)
    }
}

/**
 * Eine Anfrage ohne TLS, die der Wächter nicht sendet. Eigener Typ, damit die
 * Datenschicht daraus eine Meldung mit Anleitung macht statt „Netzfehler“.
 */
class KlartextAbgelehnt(val host: String) :
    IOException("Unverschlüsselte Verbindung zu $host abgelehnt: Die App spricht nur https.")
