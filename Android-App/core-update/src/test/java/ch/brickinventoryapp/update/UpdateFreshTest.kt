package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UpdateBeschreibung
import ch.brickinventoryapp.update.util.UpdateFresh
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
import ch.brickinventoryapp.update.util.offerableVersion
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.checkFresh
import ch.brickinventoryapp.update.util.sourceStale
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.cert.CertificateFactory
import java.util.Base64

/**
 * Frische der Update-Beschreibung: Wer Schreibrecht am Repository hat,
 * kann eine ältere, echt signierte version-signiert.json wieder hochladen. Die App
 * merkt sich den höchsten gesehenen Stand und meldet eine ältere oder abgelaufene
 * Beschreibung, statt „aktuell“ zu sagen.
 *
 * Gegenproben:
 *   A  in valueFresh() die Zeile mit `gesehen != null && …` entfernt → rot
 *      „an older genuinely signed description reports a withholding“;
 *      gegenproben/update-zurueckgehalten.patch
 *   B  in valueFresh() `|| b.gueltigBis <= nowSec` entfernt → rot „eine
 *      abgelaufene oder fristlose Beschreibung ist nie aktuell“;
 *      gegenproben/update-ohne-frist.patch
 *   C  in checkFresh() den Stand auch ohne AKTUELL fortgeschrieben → rot
 *      „eine abgelaufene oder fristlose …“ (eine abgelaufene setzte die Messlatte)
 *   D  in offerableVersion() die Bedingung
 *      `frische != UpdateFresh.ZURUECKGESETZT &&` gestrichen → rot „aus einer
 *      zurueckgesetzten Beschreibung wird nichts angeboten“;
 *      gegenproben/update-angebot-trotz-zuruecksetzen.patch
 *   E  offerableVersion() verlangt wieder AKTUELL → rot „eine abgelaufene, neuere
 *      Beschreibung wird mit Hinweis angeboten“; gegenproben/update-abgelaufen-ohne-angebot.patch
 */
class UpdateFreshTest {

    private class Ablage(var stand: UpdateStatus? = null) : UpdateStatusStore {
        override suspend fun updateStatus() = stand
        override suspend fun rememberUpdateStatus(stand: UpdateStatus) { this.stand = stand }
    }

    private val tag = 86_400L
    private val jetzt = 1_793_750_400L // 4. November 2026

    private fun beschreibung(code: Int, ausgestellt: Long = jetzt - tag, gueltig: Long = 30 * tag) =
        UpdateBeschreibung(versionCode = code, versionName = "1.$code", apkUrl = "https://x/a.apk",
            ausgestellt = ausgestellt, gueltigBis = if (ausgestellt > 0) ausgestellt + gueltig else 0)

    private fun pruefe(ablage: Ablage, b: UpdateBeschreibung, laufend: Int = 100, um: Long = jetzt) =
        runBlocking { checkFresh(ablage, b, laufend, um) }

    @Test
    fun `a fresh description applies and raises the bar`() {
        val ablage = Ablage()
        assertEquals(UpdateFresh.AKTUELL, pruefe(ablage, beschreibung(120)))
        assertEquals(UpdateStatus(120, jetzt - tag), ablage.stand)
        // Dieselbe Fassung, später neu signiert (Auffrischen), gilt ebenso.
        assertEquals(UpdateFresh.AKTUELL, pruefe(ablage, beschreibung(120, ausgestellt = jetzt)))
        assertEquals(UpdateStatus(120, jetzt), ablage.stand)
        assertFalse(sourceStale(UpdateFresh.AKTUELL))
        assertFalse("Vor der ersten Prüfung gibt es nichts zu melden", sourceStale(null))
    }

    @Test
    fun `an older genuinely signed description reports a withholding`() {
        val ablage = Ablage(UpdateStatus(120, jetzt - tag))
        assertEquals("Ältere Fassung", UpdateFresh.ZURUECKGESETZT, pruefe(ablage, beschreibung(110, ausgestellt = jetzt - 5 * tag)))
        assertEquals("Dieselbe Fassung, früher signiert", UpdateFresh.ZURUECKGESETZT,
            pruefe(ablage, beschreibung(120, ausgestellt = jetzt - 2 * tag)))
        assertEquals("Die Messlatte sinkt nicht", UpdateStatus(120, jetzt - tag), ablage.stand)
        assertTrue(sourceStale(UpdateFresh.ZURUECKGESETZT))
        // Auch ohne gemerkten Stand: älter als die installierte Fassung.
        assertEquals(UpdateFresh.ZURUECKGESETZT, pruefe(Ablage(), beschreibung(90), laufend = 100))
    }

    @Test
    fun `an expired or deadline-less description is never current`() {
        val ablage = Ablage()
        assertEquals("Nach gueltigBis", UpdateFresh.ABGELAUFEN,
            pruefe(ablage, beschreibung(120, ausgestellt = jetzt - 31 * tag)))
        assertEquals("Ohne Frist (ältere Beschreibung)", UpdateFresh.ABGELAUFEN,
            pruefe(ablage, beschreibung(120, ausgestellt = 0)))
        assertNull("Eine abgelaufene setzt keine Messlatte", ablage.stand)
        assertTrue(sourceStale(UpdateFresh.ABGELAUFEN))
    }

    /** Sonst hielte eine ältere, echt signierte Beschreibung auf einer verwundbaren Zwischenfassung fest. */
    @Test
    fun `nothing is offered from a reset description`() {
        val neu = beschreibung(120)
        assertEquals(neu, offerableVersion(neu, pruefe(Ablage(), neu), laufend = 100))
        assertNull("Nicht neuer als die laufende", offerableVersion(beschreibung(100), UpdateFresh.AKTUELL, 100))

        // Gesehen wurde schon 130; jemand spielt die echt signierte 120 wieder ein.
        val zurueck = Ablage(UpdateStatus(130, jetzt - tag))
        val alt = beschreibung(120, ausgestellt = jetzt - 5 * tag)
        assertNull("Zurückgesetzt", offerableVersion(alt, pruefe(zurueck, alt), laufend = 100))
        // Auch abgelaufen bleibt eine Beschreibung unter dem Gesehenen zurückgesetzt.
        val altAndExpired = beschreibung(120, ausgestellt = jetzt - 40 * tag)
        assertNull("Abgelaufen und älter", offerableVersion(altAndExpired, pruefe(zurueck, altAndExpired), laufend = 100))
    }

    /** Nach sieben Tagen ohne neues Etikett bliebe das Gerät sonst auf der alten Fassung stehen. */
    @Test
    fun `an expired, newer description is offered with a hint`() {
        val ablage = Ablage(UpdateStatus(110, jetzt - 40 * tag))
        val abgelaufen = beschreibung(120, ausgestellt = jetzt - 31 * tag)
        val frische = pruefe(ablage, abgelaufen)
        assertEquals(UpdateFresh.ABGELAUFEN, frische)
        assertEquals(abgelaufen, offerableVersion(abgelaufen, frische, laufend = 100))
        assertTrue("Der Hinweis „könnte Neueres geben“ bleibt", sourceStale(frische))
        assertEquals("Die Messlatte bleibt", UpdateStatus(110, jetzt - 40 * tag), ablage.stand)
        assertNull("Nicht neuer als die laufende", offerableVersion(abgelaufen, frische, laufend = 120))
    }

    @Test
    fun `deadline and issue come from the signed description`() {
        // Signiert wie im Job `signieren` (openssl dgst -sha256 -sign), ECDSA-Testschlüssel.
        val schluessel = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(ZERT).inputStream()).publicKey.encoded
        val b = checkedDescription("""{"daten":"$DATA","beschreibungssignatur":"$SIG"}""", listOf(schluessel))
        assertNotNull(b)
        assertEquals(1_793_750_400L, b!!.ausgestellt)
        assertEquals(1_793_750_400L + 30 * tag, b.gueltigBis)
        assertEquals(UpdateFresh.AKTUELL, pruefe(Ablage(), b, laufend = 200_001_400, um = b.ausgestellt + tag))
        assertEquals(UpdateFresh.ABGELAUFEN, pruefe(Ablage(), b, laufend = 200_001_400, um = b.gueltigBis))
    }

    private companion object {
        const val ZERT = "MIIBhDCCASugAwIBAgIUOxM5gBxl0qitzzAFYNEQvBBaXO0wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBGcmlzY2hlMCAXDTI2MTEwNDA2MDc1OFoYDzIxMjYxMDExMDYwNzU4WjAXMRUwEwYDVQQDDAxUZXN0IEZyaXNjaGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASwmLz2s28ezP9h5c7ao9/i17GGcJwibPmkt1uH8IYnWsZ1AGS4z0WASs9a7/WYN+EPEadvrWgfBKbDWk7whgsFo1MwUTAdBgNVHQ4EFgQU5lHEp3GPZFyo2KfX/GcKOp1wmh8wHwYDVR0jBBgwFoAU5lHEp3GPZFyo2KfX/GcKOp1wmh8wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBJ5bPnsYOM7h6uB+7+Ut8I7Sj18ygMWKwJNs5wwPiKIAIgcqkdXHKc9nbv9O5AG2XqdGSqd11gZlejQhylJOzrq/Q="
        const val DATA = "eyJ2ZXJzaW9uQ29kZSI6MjAwMDAxNTAwLCJ2ZXJzaW9uTmFtZSI6IjEuMy4wIiwiY29tbWl0IjoiYWJjMTIzIiwiYXBrVXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2FkZGljdDg1L0JyaWNrSW52ZW50b3J5L3JlbGVhc2VzL2Rvd25sb2FkL2FuZHJvaWQtdjEuMy4wL0JyaWNrSW52ZW50b3J5LTIwMDAwMTUwMC5hcGsiLCJhcGtTaXplIjo0LCJhcGtTaGEyNTYiOiI5Zjg2ZDA4MTg4NGM3ZDY1OWEyZmVhYTBjNTVhZDAxNWEzYmY0ZjFiMmIwYjgyMmNkMTVkNmMxNWIwZjAwYTA4IiwiYXVzZ2VzdGVsbHQiOjE3OTM3NTA0MDAsImd1ZWx0aWdCaXMiOjE3OTYzNDI0MDB9"
        const val SIG = "MEQCIF+69viCc+QO92nr9EPancVYNxodogfnQ4kDg+qDe87qAiBs4aFtp8byDLtIbOFrd0/bCMCvDUu9hMzRyG++Q3nNvw=="
    }
}
