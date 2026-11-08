package ch.brickinventoryapp.util

import java.net.InetAddress
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

/**
 * Die TLS-Fabrik der Server-Clients, deren SSLContext sich ersetzen lässt. Eine
 * wiederaufgenommene TLS-Sitzung prüft keine Kette; nach dem Ausschalten der
 * Nutzer-CAs nähme der alte Kontext eine über sie vertraute Sitzung sonst wieder
 * auf. OkHttp hält die Fabrik fest, darum wechselt hier der Inhalt, nicht der Client.
 */
class ErneuerbareTlsFabrik(private val baue: () -> SSLSocketFactory) : SSLSocketFactory() {
    @Volatile private var jetzt: SSLSocketFactory = baue()

    /** Neuer Kontext, leerer Sitzungsspeicher; laufende Verbindungen behalten den alten. */
    fun erneuere() { jetzt = baue() }

    override fun getDefaultCipherSuites(): Array<String> = jetzt.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = jetzt.supportedCipherSuites
    override fun createSocket(): Socket = jetzt.createSocket()
    override fun createSocket(s: Socket?, host: String?, port: Int, autoClose: Boolean): Socket =
        jetzt.createSocket(s, host, port, autoClose)
    override fun createSocket(host: String?, port: Int): Socket = jetzt.createSocket(host, port)
    override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
        jetzt.createSocket(host, port, localHost, localPort)
    override fun createSocket(host: InetAddress?, port: Int): Socket = jetzt.createSocket(host, port)
    override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
        jetzt.createSocket(address, port, localAddress, localPort)
}
