package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.ChoiceTrust
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedTrustManager

/**
 * User-installed CAs apply only by explicit setting, and only
 * then is the CA store read at all.
 *
 * Counter-checks:
 *   A  wahl() always `withUser.value` → red “without the setting only the system applies”
 *      and “with the setting the user CAs apply, immediately”
 *   B  checkClientTrusted on wahl() instead of on system → red “client checks
 *      stay with the system”
 */
class ServerTrustTest {

    /** Accepts only if [takesAn]; records which check came. */
    private class Checker(val name: String, val takesAn: Boolean, val log: MutableList<String>) : X509ExtendedTrustManager() {
        private fun pruefe(art: String) {
            log += "$name:$art"
            if (!takesAn) throw CertificateException("$name vertraut nicht")
        }
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = pruefe("server")
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = pruefe("server")
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String) = pruefe("server")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = pruefe("client")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = pruefe("client")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = pruefe("client")
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private val log = mutableListOf<String>()
    private var gelesen = false
    private var erlaubt = false
    private val vertrauen = ChoiceTrust(
        system = Checker("system", takesAn = false, log),
        withUser = lazy { gelesen = true; Checker("nutzer", takesAn = true, log) },
        userAllowed = { erlaubt },
    )

    private fun serverChecked(): Boolean =
        runCatching { vertrauen.checkServerTrusted(emptyArray(), "RSA", null as Socket?) }.isSuccess

    @Test
    fun `without the setting only the system applies`() {
        assertFalse("Ein selbst ausgestelltes Zertifikat ginge ohne Einstellung durch", serverChecked())
        assertEquals(listOf("system:server"), log)
        assertFalse("Der CA-Speicher wird ohne Bedarf nicht gelesen", gelesen)
    }

    @Test
    fun `with the setting the user CAs apply, immediately`() {
        assertFalse(serverChecked())
        erlaubt = true
        assertTrue(serverChecked())
        erlaubt = false
        assertFalse("Ausschalten wirkt ohne Neustart", serverChecked())
    }

    @Test
    fun `client checks stay with the system`() {
        erlaubt = true
        runCatching { vertrauen.checkClientTrusted(emptyArray(), "RSA", null as Socket?) }
        assertEquals(listOf("system:client"), log)
    }
}
