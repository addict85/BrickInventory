package ch.brickinventoryapp

import ch.brickinventoryapp.util.eigeneAdresse
import ch.brickinventoryapp.util.externeAdresse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Welche Adressen aus Serverdaten die App an den Browser gibt (nur https) und wie
 * ein `local_path` zur Adresse des eigenen Servers wird (aufgelöst, nie fremd).
 *
 * Gegenproben (01.11.2026, gemessen gegen util/ExterneAdresse.kt):
 *   A  in externeAdresse() `.takeIf { it.isHttps }` entfernt → rot „nur https
 *      geht an den Browser“ (http durchgelassen)
 *   B  in eigeneAdresse() die Prüfung auf denselben Host entfernt → rot „ein
 *      local_path bleibt auf dem eigenen Server“
 */
class ExterneAdresseTest {

    @Test
    fun `nur https geht an den Browser`() {
        assertEquals("https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1",
            externeAdresse(" https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1 ").toString())
        for (fremd in listOf("http://www.bricklink.com/x", "intent://scan/#Intent;scheme=zxing;end", "file:///data/data/x",
                             "content://ch.brickinventoryapp.provider/x", "javascript:alert(1)", "", null)) {
            assertNull("$fremd", externeAdresse(fremd))
        }
    }

    @Test
    fun `ein local_path bleibt auf dem eigenen Server`() {
        assertEquals("https://nas:8443/brick/uploads/a.pdf", eigeneAdresse("https://nas:8443/brick/", "uploads/a.pdf"))
        assertEquals("Unterpfad bleibt wie bei der Verkettung",
            "https://nas:8443/brick/uploads/a.pdf", eigeneAdresse("https://nas:8443/brick", "/uploads/a.pdf"))
        assertEquals("https://nas:8443/uploads/a%20b.pdf", eigeneAdresse("https://nas:8443", "/uploads/a b.pdf"))
        assertEquals("Zwei Schrägstriche führen nicht zu einem anderen Host",
            "https://nas:8443/fremd.example/a.pdf", eigeneAdresse("https://nas:8443", "//fremd.example/a.pdf"))
        assertNull(eigeneAdresse("https://nas:8443", "https://fremd.example/a.pdf"))
        assertNull(eigeneAdresse("https://nas:8443", "http://nas:8443/a.pdf"))
    }
}
