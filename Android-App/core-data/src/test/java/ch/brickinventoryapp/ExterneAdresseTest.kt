package ch.brickinventoryapp

import ch.brickinventoryapp.util.eigeneAdresse
import ch.brickinventoryapp.util.externeAdresse
import ch.brickinventoryapp.util.otpauthAdresse
import ch.brickinventoryapp.util.pdfImBetrachter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
 *   C  (01.11.2026) in otpauthAdresse() die Schema-Prüfung entfernt → rot „an
 *      die Authenticator-App geht nur otpauth“ (https durchgelassen)
 *   D  (03.11.2026, kotlinc lokal) pdfImBetrachter() ohne die Prüfung der
 *      Herkunft (`ziel.isHttps || serverUrl.isNotBlank()`) → rot „der PDF-Betrachter laedt nur vom eigenen Server“
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
    fun `an die Authenticator-App geht nur otpauth`() {
        val echt = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP&issuer=BrickInventory"
        assertEquals(echt, otpauthAdresse(" $echt "))
        assertEquals("OTPAUTH://hotp/x?secret=A", otpauthAdresse("OTPAUTH://hotp/x?secret=A"))
        for (fremd in listOf("https://fremd.example/?secret=JBSWY3DP", "intent://totp/#Intent;scheme=otpauth;end",
                             "otpauth:totp/x?secret=A", "otpauth://evil/x?secret=A", "otpauth://totp/x y?secret=A",
                             "content://ch.brickinventoryapp.provider/x", "", null)) {
            assertNull("$fremd", otpauthAdresse(fremd))
        }
    }

    @Test
    fun `der PDF-Betrachter laedt nur vom eigenen Server`() {
        assertTrue(pdfImBetrachter("https://nas:8443/brick/api/v1/vouchers/7/pdf", "https://nas:8443/brick"))
        assertTrue(pdfImBetrachter("https://NAS:8443/uploads/a.pdf", "https://nas:8443/"))
        for (fremd in listOf("https://www.lego.com/cdn/a.pdf", "http://nas:8443/a.pdf", "https://nas:9443/a.pdf",
                             "https://nas.example.evil:8443/a.pdf", "content://x/a.pdf", "")) {
            assertFalse(fremd, pdfImBetrachter(fremd, "https://nas:8443"))
        }
        assertFalse("Ohne Server kein Betrachter", pdfImBetrachter("https://nas:8443/a.pdf", ""))
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
