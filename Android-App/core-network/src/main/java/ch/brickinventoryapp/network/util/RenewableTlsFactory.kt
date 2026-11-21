package ch.brickinventoryapp.network.util

import java.net.InetAddress
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

/**
 * The TLS factory of the server clients, whose SSLContext can be swapped out. A
 * resumed TLS session skips chain validation; after turning off user CAs, the
 * old context would otherwise resume a session trusted through them. OkHttp
 * holds on to the factory itself, so here it is the content that changes, not
 * the client.
 */
class RenewableTlsFactory(private val build: () -> SSLSocketFactory) : SSLSocketFactory() {
    @Volatile private var jetzt: SSLSocketFactory = build()

    /** New context, empty session cache; connections already running keep the old one. */
    fun renew() { jetzt = build() }

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
