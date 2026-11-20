package ch.brickinventoryapp.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Die zwei Schlüssel der Geräteablage: Namen von Einträgen verraten nichts über den Server,
 * und eine Angabe unter dem Entsperr-Schlüssel ist bei gesperrtem Gerät „später“, nicht „weg“.
 *
 * Gegenproben (kotlinc und JUnit lokal):
 *   A  name() gibt die Bindung selbst zurück → rot „ein Name verraet den Server nicht …“;
 *      gegenproben/pin-name-im-klartext.patch
 *   B  openDetail() holt den Schlüssel innerhalb der Prüfung (gesperrt wird „weg“) → rot
 *      „gesperrt ist eine Angabe spaeter lesbar, nicht weg“; gegenproben/angabe-gesperrt-wie-weg.patch
 */
class VertrauenschiffreTest {

    private val vertrauen = ByteArray(32) { 1 }
    private val detailsKey = ByteArray(32) { 2 }
    private var gesperrt = false
    private val cipher = Vertrauenschiffre(angaben = {
        if (gesperrt) throw IOException("Keystore gerade nicht bereit")
        detailsKey
    }) { vertrauen }

    @Test
    fun `ein Name verraet den Server nicht und bleibt gleich`() {
        val name = cipher.name("brick.example.org:443")!!
        assertFalse(name, "brick" in name || "443" in name)
        assertEquals("Derselbe Server, derselbe Name", name, cipher.name("brick.example.org:443"))
        assertNotEquals(name, cipher.name("nas.local:8443"))
        assertNotEquals("Anderer Schlüssel, anderer Name", name, Vertrauenschiffre { ByteArray(32) { 9 } }.name("brick.example.org:443"))
        assertTrue("Als Schlüssel einer Ablage brauchbar: $name", name.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        gesperrt = true
        assertEquals("Der Vertrauensschlüssel arbeitet auch gesperrt", name, cipher.name("brick.example.org:443"))
    }

    @Test
    fun `gesperrt ist eine Angabe spaeter lesbar, nicht weg`() {
        val geheim = cipher.verschluessleDetail("https://brick.example.org", "server_url")!!
        assertFalse(geheim, "brick" in geheim)
        gesperrt = true
        assertEquals(Tresorbefund.Gesperrt, cipher.openDetail(geheim, "server_url"))
        assertNull("Gesperrt wird nichts abgelegt", cipher.verschluessleDetail("x", "server_url"))
        gesperrt = false
        assertEquals(Tresorbefund.Readable("https://brick.example.org"), cipher.openDetail(geheim, "server_url"))
    }

    @Test
    fun `eine Angabe unter fremdem Namen oder Schluessel ist weg`() {
        val geheim = cipher.verschluessleDetail("anna", "username")!!
        assertEquals(Tresorbefund.Weg, cipher.openDetail(geheim, "server_url"))
        assertEquals(Tresorbefund.Weg, Vertrauenschiffre { vertrauen }.openDetail(geheim, "username"))
        assertEquals(Tresorbefund.Weg, cipher.openDetail("kein-base64-%%%", "username"))
        assertNull("Ein Pin-Geheimtext ist keine Angabe", cipher.entschluessle(geheim, "username"))
    }
}
