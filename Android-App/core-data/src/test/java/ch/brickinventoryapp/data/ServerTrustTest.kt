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
 *   A  choice() always `withUser.value` → red “without the setting only the system applies”
 *      and “with the setting the user CAs apply, immediately”
 *   B  checkClientTrusted on choice() instead of on system → red “client checks
 *      stay with the system”
 */
class ServerTrustTest {

    /** Accepts only if [accepts]; records which check came. */
    private class Checker(val name: String, val accepts: Boolean, val log: MutableList<String>) : X509ExtendedTrustManager() {
        private fun check(kind: String) {
            log += "$name:$kind"
            if (!accepts) throw CertificateException("$name does not trust")
        }
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = check("server")
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = check("server")
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String) = check("server")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = check("client")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = check("client")
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = check("client")
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private val log = mutableListOf<String>()
    private var read = false
    private var allowed = false
    private val trust = ChoiceTrust(
        system = Checker("system", accepts = false, log),
        withUser = lazy { read = true; Checker("nutzer", accepts = true, log) },
        userAllowed = { allowed },
    )

    private fun serverChecked(): Boolean =
        runCatching { trust.checkServerTrusted(emptyArray(), "RSA", null as Socket?) }.isSuccess

    @Test
    fun `without the setting only the system applies`() {
        assertFalse("A self-issued certificate would pass without the setting", serverChecked())
        assertEquals(listOf("system:server"), log)
        assertFalse("The CA store is not read without need", read)
    }

    @Test
    fun `with the setting the user CAs apply, immediately`() {
        assertFalse(serverChecked())
        allowed = true
        assertTrue(serverChecked())
        allowed = false
        assertFalse("Switching off takes effect without restart", serverChecked())
    }

    @Test
    fun `client checks stay with the system`() {
        allowed = true
        runCatching { trust.checkClientTrusted(emptyArray(), "RSA", null as Socket?) }
        assertEquals(listOf("system:client"), log)
    }
}
