package ch.brickinventoryapp.util

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Netzregeln des Interceptors. Der Token geht nur an dieselbe Herkunft (Schema,
 * Host, Port), nie per String-Präfix. Klartext nur zu privaten Adressen, weil die
 * Network-Security-Config keine RFC1918-Wildcards kennt.
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
     * Suffixe, die ausschliesslich im lokalen Netz vergeben werden. `.box` ist
     * eine öffentliche Endung; lokal ist nur die der Fritzbox.
     */
    private val LOCAL_SUFFIXES = listOf(
        ".local", ".localhost", ".home.arpa", ".lan", ".home", ".internal", ".intern", ".fritz.box"
    )

    /**
     * Privat = LAN, Loopback, mDNS oder ein Name, der öffentlich gar nicht auflösbar
     * wäre. Gewöhnliche Hostnamen wie http://nas:3000, http://raspberrypi:3000 oder
     * http://brick.fritz.box müssen durch — unter ihnen ist ein selbstgehosteter
     * Server im Heimnetz üblicherweise erreichbar. Ein Name ohne Punkt kann nicht
     * öffentlich auflösen, er ist per Definition ein Intranet-Name.
     */
    fun isPrivateHost(host: String): Boolean {
        val h = host.lowercase().trim('[', ']')
        if (h == "localhost") return true
        if (LOCAL_SUFFIXES.any { h.endsWith(it) }) return true
        // Einzelnes Label ohne Punkt → Intranet-Name (nas, synology, brickserver …)
        if (!h.contains('.') && !h.contains(':')) return true

        // IPv6 nur prüfen, wenn es auch wirklich eine IPv6-Adresse ist —
        // sonst würde ein Hostname wie "fcbayern.example" über den
        // fc/fd-Präfix (Unique Local Address) als privat durchgehen.
        if (h.contains(':')) {
            return h == "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")
        }

        val parts = h.split('.')
        if (parts.size != 4) return false
        val o = parts.map { it.toIntOrNull() ?: return false }
        if (o.any { it !in 0..255 }) return false
        return when {
            o[0] == 10 -> true                              // 10.0.0.0/8
            o[0] == 127 -> true                             // Loopback
            o[0] == 172 && o[1] in 16..31 -> true           // 172.16.0.0/12
            o[0] == 192 && o[1] == 168 -> true              // 192.168.0.0/16
            o[0] == 169 && o[1] == 254 -> true              // Link-local
            else -> false
        }
    }

    /**
     * Darf diese Anfrage unverschlüsselt rausgehen?
     *
     * Eine öffentliche IP über http nie. Ein öffentlich aussehender NAME nur,
     * wenn der Nutzer genau diesen Host in der Einrichtung bestätigt hat — ein
     * Heimnetz-Name kann öffentlich aussehen (brick.meinname.ch), darum kein
     * hartes Verbot, aber auch kein stilles Durchlassen mehr.
     */
    fun isCleartextAllowed(url: HttpUrl, bestaetigt: Set<String> = emptySet()): Boolean {
        if (url.isHttps) return true
        if (isPrivateHost(url.host)) return true
        if (isIpLiteral(url.host)) return false
        return url.host.lowercase() in bestaetigt
    }

    /** Der Host, den die Einrichtung bestätigen lassen muss — oder null. */
    fun klartextHost(serverUrl: String): String? {
        val url = serverUrl.trim().toHttpUrlOrNull() ?: return null
        return if (!url.isHttps && !isPrivateHost(url.host) && !isIpLiteral(url.host)) url.host.lowercase() else null
    }

    /**
     * Geht der Zugang zu dieser Server-Adresse unverschlüsselt aus dem lokalen
     * Netz? Die Einrichtung zeigt dann eine Warnung; blockiert wird nicht, weil
     * ein Heimnetz-Name auch öffentlich aussehen kann.
     */
    fun klartextNachAussen(serverUrl: String): Boolean {
        val url = serverUrl.trim().toHttpUrlOrNull() ?: return false
        return !url.isHttps && !isPrivateHost(url.host)
    }

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

    private fun istLoopback(host: String): Boolean {
        val h = host.lowercase().trim('[', ']')
        return h == "localhost" || h == "::1" || h.startsWith("127.")
    }

    /**
     * Ein Passwort über http in einem Netz, in dem dieser Server nie eingerichtet
     * oder bestätigt wurde, braucht eine Rückfrage: Im fremden WLAN kann
     * „http://nas:3000“ ein anderer Rechner sein. Ohne Kennung des Netzes
     * ([netz] null) ist es immer ein unbekanntes.
     */
    fun anmeldungBrauchtNetzBestaetigung(serverUrl: String, netz: String?, bekannt: Set<String>): Boolean {
        val url = serverUrl.trim().toHttpUrlOrNull() ?: return false
        if (url.isHttps || istLoopback(url.host)) return false
        return netz == null || netzEintrag(serverUrl, netz) !in bekannt
    }

    /** Der gemerkte Eintrag „dieser Server in diesem Netz“. */
    fun netzEintrag(serverUrl: String, netz: String): String = "${herkunft(serverUrl)}|$netz"

    /** Ist der Host eine numerische IPv4/IPv6-Adresse (kein Name)? */
    fun isIpLiteral(host: String): Boolean {
        val h = host.trim('[', ']')
        if (h.contains(':')) return true
        val parts = h.split('.')
        return parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }
    }
}
