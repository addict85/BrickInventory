package ch.brickinventoryapp.sicherheit

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
 *   B  oeffneAngabe() holt den Schlüssel innerhalb der Prüfung (gesperrt wird „weg“) → rot
 *      „gesperrt ist eine Angabe spaeter lesbar, nicht weg“; gegenproben/angabe-gesperrt-wie-weg.patch
 */
class VertrauenschiffreTest {

    private val vertrauen = ByteArray(32) { 1 }
    private val angabenSchluessel = ByteArray(32) { 2 }
    private var gesperrt = false
    private val chiffre = Vertrauenschiffre(angaben = {
        if (gesperrt) throw IOException("Keystore gerade nicht bereit")
        angabenSchluessel
    }) { vertrauen }

    @Test
    fun `ein Name verraet den Server nicht und bleibt gleich`() {
        val name = chiffre.name("brick.example.org:443")!!
        assertFalse(name, "brick" in name || "443" in name)
        assertEquals("Derselbe Server, derselbe Name", name, chiffre.name("brick.example.org:443"))
        assertNotEquals(name, chiffre.name("nas.local:8443"))
        assertNotEquals("Anderer Schlüssel, anderer Name", name, Vertrauenschiffre { ByteArray(32) { 9 } }.name("brick.example.org:443"))
        assertTrue("Als Schlüssel einer Ablage brauchbar: $name", name.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        gesperrt = true
        assertEquals("Der Vertrauensschlüssel arbeitet auch gesperrt", name, chiffre.name("brick.example.org:443"))
    }

    @Test
    fun `gesperrt ist eine Angabe spaeter lesbar, nicht weg`() {
        val geheim = chiffre.verschluessleAngabe("https://brick.example.org", "server_url")!!
        assertFalse(geheim, "brick" in geheim)
        gesperrt = true
        assertEquals(Tresorbefund.Gesperrt, chiffre.oeffneAngabe(geheim, "server_url"))
        assertNull("Gesperrt wird nichts abgelegt", chiffre.verschluessleAngabe("x", "server_url"))
        gesperrt = false
        assertEquals(Tresorbefund.Lesbar("https://brick.example.org"), chiffre.oeffneAngabe(geheim, "server_url"))
    }

    @Test
    fun `eine Angabe unter fremdem Namen oder Schluessel ist weg`() {
        val geheim = chiffre.verschluessleAngabe("anna", "username")!!
        assertEquals(Tresorbefund.Weg, chiffre.oeffneAngabe(geheim, "server_url"))
        assertEquals(Tresorbefund.Weg, Vertrauenschiffre { vertrauen }.oeffneAngabe(geheim, "username"))
        assertEquals(Tresorbefund.Weg, chiffre.oeffneAngabe("kein-base64-%%%", "username"))
        assertNull("Ein Pin-Geheimtext ist keine Angabe", chiffre.entschluessle(geheim, "username"))
    }
}
