package ch.brickinventoryapp.util

import java.net.Socket
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Welchen Zertifizierungsstellen die Clients des eigenen Servers vertrauen: nur
 * den System-CAs, oder auf ausdrückliche Einstellung zusätzlich den vom Nutzer
 * installierten (selbst ausgestelltes Zertifikat). Je Verbindungsaufbau gefragt,
 * damit der Schalter ohne Neustart wirkt. Eine nutzerinstallierte CA kann sonst
 * jeder einschleusen, der kurz ans Gerät kommt oder es verwaltet.
 */
class WahlVertrauen(
    private val system: X509ExtendedTrustManager,
    /** Erst beim ersten Bedarf: Der CA-Speicher liest Hunderte Zertifikate von der Platte. */
    private val mitNutzer: Lazy<X509ExtendedTrustManager>,
    private val nutzerErlaubt: () -> Boolean,
) : X509ExtendedTrustManager() {

    private fun wahl() = if (nutzerErlaubt()) mitNutzer.value else system

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        wahl().checkServerTrusted(chain, authType, socket)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        wahl().checkServerTrusted(chain, authType, engine)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        wahl().checkServerTrusted(chain, authType)

    // Die App weist sich nicht per Zertifikat aus; Client-Prüfungen bleiben beim System.
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        system.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        system.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = wahl().acceptedIssuers
}

/**
 * Die Vorgabe beim ersten Start mit dieser Regel: Bisher galten Nutzer-CAs für
 * jeden Server. Wer schon über https eingerichtet ist, behält das, damit ein
 * Update ihn nicht aussperrt; eine Neuinstallation beginnt ohne.
 */
fun nutzerCaVorgabe(serverUrlBeimUpdate: String): Boolean =
    serverUrlBeimUpdate.trim().lowercase().startsWith("https://")
