package ch.brickinventoryapp

import ch.brickinventoryapp.util.WahlVertrauen
import ch.brickinventoryapp.util.nutzerCaVorgabe
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
 * Nutzerinstallierte CAs gelten nur auf ausdrückliche Einstellung, und erst
 * dann wird der CA-Speicher überhaupt gelesen.
 *
 * Gegenproben (29.10.2026, gemessen gegen util/ServerVertrauen.kt):
 *   A  wahl() immer `mitNutzer.value` → rot „ohne Einstellung gilt nur das System“
 *      und „mit Einstellung gelten die Nutzer-CAs, sofort“
 *   B  checkClientTrusted an wahl() statt an system → rot „Client-Prüfungen
 *      bleiben beim System“
 *   C  nutzerCaVorgabe() immer true → rot „eine Neuinstallation beginnt ohne
 *      Nutzer-CAs“
 */
class ServerVertrauenTest {

    /** Nimmt nur an, wenn [nimmtAn]; schreibt mit, welche Prüfung kam. */
    private class Pruefer(val name: String, val nimmtAn: Boolean, val log: MutableList<String>) : X509ExtendedTrustManager() {
        private fun pruefe(art: String) {
            log += "$name:$art"
            if (!nimmtAn) throw CertificateException("$name vertraut nicht")
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
    private val vertrauen = WahlVertrauen(
        system = Pruefer("system", nimmtAn = false, log),
        mitNutzer = lazy { gelesen = true; Pruefer("nutzer", nimmtAn = true, log) },
        nutzerErlaubt = { erlaubt },
    )

    private fun serverGeprueft(): Boolean =
        runCatching { vertrauen.checkServerTrusted(emptyArray(), "RSA", null as Socket?) }.isSuccess

    @Test
    fun `ohne Einstellung gilt nur das System`() {
        assertFalse("Ein selbst ausgestelltes Zertifikat ginge ohne Einstellung durch", serverGeprueft())
        assertEquals(listOf("system:server"), log)
        assertFalse("Der CA-Speicher wird ohne Bedarf nicht gelesen", gelesen)
    }

    @Test
    fun `mit Einstellung gelten die Nutzer-CAs, sofort`() {
        assertFalse(serverGeprueft())
        erlaubt = true
        assertTrue(serverGeprueft())
        erlaubt = false
        assertFalse("Ausschalten wirkt ohne Neustart", serverGeprueft())
    }

    @Test
    fun `Client-Pruefungen bleiben beim System`() {
        erlaubt = true
        runCatching { vertrauen.checkClientTrusted(emptyArray(), "RSA", null as Socket?) }
        assertEquals(listOf("system:client"), log)
    }

    @Test
    fun `eine Neuinstallation beginnt ohne Nutzer-CAs, ein https-Altbestand behaelt sie`() {
        assertFalse(nutzerCaVorgabe(""))
        assertFalse(nutzerCaVorgabe("http://nas:3000"))
        assertTrue(nutzerCaVorgabe(" HTTPS://brick.example.org"))
    }
}
