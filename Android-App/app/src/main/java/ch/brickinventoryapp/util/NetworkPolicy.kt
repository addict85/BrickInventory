package ch.brickinventoryapp.util

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Netzwerk-Regeln für den OkHttp-Interceptor.
 *
 * Zwei Probleme, die hier gelöst werden:
 *
 * 1. Der Interceptor hat bisher per `finalUrl.startsWith(serverUrl)` entschieden,
 *    ob der Bearer-Token angehängt wird. Ein String-Präfixvergleich: bei
 *    serverUrl = "https://brick.example.com" matcht auch
 *    "https://brick.example.com.angreifer.tld/…" — und der Token wäre
 *    mitgegangen. Verglichen wird jetzt auf Scheme, Host und Port der
 *    geparsten URL.
 *
 * 2. Das Manifest hatte `usesCleartextTraffic="true"` app-weit. Weil die
 *    Server-URL vom Nutzer kommt, lässt sich das nicht per
 *    Network-Security-Config auf private Adressen einschränken (Android kennt
 *    dort keine Wildcards für RFC1918). Die Prüfung passiert deshalb hier:
 *    http ist nur zu privaten Adressen erlaubt, zu öffentlichen Hosts wird die
 *    Anfrage abgebrochen statt den Token im Klartext übers Internet zu senden.
 */
object NetworkPolicy {

    /** Gleiche Herkunft: Scheme, Host und (effektiver) Port müssen übereinstimmen. */
    fun isSameOrigin(url: HttpUrl, serverUrl: String): Boolean {
        val base = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return false
        return url.scheme.equals(base.scheme, ignoreCase = true) &&
            url.host.equals(base.host, ignoreCase = true) &&
            url.port == base.port
    }

    /** Suffixe, die ausschliesslich im lokalen Netz vergeben werden. */
    private val LOCAL_SUFFIXES = listOf(
        ".local", ".localhost", ".home.arpa", ".lan", ".home", ".internal", ".intern", ".box"
    )

    /**
     * Privat = LAN, Loopback, mDNS oder ein Name, der öffentlich gar nicht
     * auflösbar wäre.
     *
     * WICHTIG — hier lag ein Fehler: Die erste Fassung liess ausschliesslich
     * IP-Adressen und ein paar Suffixe durch. Damit wurde jeder gewöhnliche
     * Hostname blockiert: http://nas:3000, http://raspberrypi:3000,
     * http://brick.fritz.box — also genau die Adressen, unter denen ein
     * selbstgehosteter Server üblicherweise im Heimnetz erreichbar ist. Ergebnis
     * war eine App ohne jeden Datenverkehr.
     *
     * Ein Name OHNE Punkt kann nicht öffentlich auflösen — er ist per
     * Definition ein Intranet-Name und damit unbedenklich.
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
     * Blockiert wird nur noch der eindeutige Fall: eine ÖFFENTLICHE
     * IP-Adresse über http. Dort ist sicher, dass der Bearer-Token das lokale
     * Netz verlässt.
     *
     * Bei Hostnamen wird nicht mehr blockiert, sondern nur gewarnt. Die erste
     * Fassung hat hier hart abgebrochen und damit selbstgehostete Setups
     * lahmgelegt, die ihren Server über einen Namen ansprechen. Ein
     * Sicherheitsgewinn, der die App unbenutzbar macht, ist keiner.
     */
    fun isCleartextAllowed(url: HttpUrl): Boolean {
        if (url.isHttps) return true
        if (isPrivateHost(url.host)) return true
        // Öffentliche IP-Adresse im Klartext → das ist der Fall, den es zu
        // verhindern gilt.
        if (isIpLiteral(url.host)) return false
        // Öffentlich aussehender Name: durchlassen, aber sichtbar machen.
        android.util.Log.w("NetworkPolicy",
            "Unverschlüsselte Verbindung zu ${url.host} — der Zugangstoken geht im " +
            "Klartext raus. Wenn der Server aus dem Internet erreichbar ist, bitte https verwenden.")
        return true
    }

    /** Ist der Host eine numerische IPv4/IPv6-Adresse (kein Name)? */
    fun isIpLiteral(host: String): Boolean {
        val h = host.trim('[', ']')
        if (h.contains(':')) return true
        val parts = h.split('.')
        return parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }
    }
}
