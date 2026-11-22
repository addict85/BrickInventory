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
 * Freshness of the update description: whoever has write access to the repository
 * can re-upload an older, genuinely signed version-signiert.json. The app
 * remembers the highest state seen and reports an older or expired
 * description instead of saying "current".
 *
 * Counter-checks:
 *   A  the line with `gesehen != null && …` removed from valueFresh() → red
 *      „an older genuinely signed description reports a withholding“;
 *      gegenproben/update-zurueckgehalten.patch
 *   B  `|| b.gueltigBis <= nowSec` removed from valueFresh() → red „eine
 *      abgelaufene oder fristlose Beschreibung ist nie aktuell“;
 *      gegenproben/update-ohne-frist.patch
 *   C  in checkFresh() the state advanced even without AKTUELL → red
 *      „eine abgelaufene oder fristlose …“ (an expired one moved the benchmark)
 *   D  the condition
 *      `frische != UpdateFresh.ZURUECKGESETZT &&` removed from offerableVersion() → red „aus einer
 *      zurueckgesetzten Beschreibung wird nichts angeboten“;
 *      gegenproben/update-angebot-trotz-zuruecksetzen.patch
 *   E  offerableVersion() requires AKTUELL again → red „eine abgelaufene, neuere
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
        // The same version, re-signed later (refresh), counts the same way.
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
        // Even without a remembered state: older than the installed version.
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

    /** Otherwise an older, genuinely signed description would hold on a vulnerable intermediate version. */
    @Test
    fun `nothing is offered from a reset description`() {
        val neu = beschreibung(120)
        assertEquals(neu, offerableVersion(neu, pruefe(Ablage(), neu), laufend = 100))
        assertNull("Nicht neuer als die laufende", offerableVersion(beschreibung(100), UpdateFresh.AKTUELL, 100))

        // 130 was already seen; someone replays the genuinely signed 120.
        val zurueck = Ablage(UpdateStatus(130, jetzt - tag))
        val alt = beschreibung(120, ausgestellt = jetzt - 5 * tag)
        assertNull("Zurückgesetzt", offerableVersion(alt, pruefe(zurueck, alt), laufend = 100))
        // Even expired, a description below the seen one stays rolled back.
        val altAndExpired = beschreibung(120, ausgestellt = jetzt - 40 * tag)
        assertNull("Abgelaufen und älter", offerableVersion(altAndExpired, pruefe(zurueck, altAndExpired), laufend = 100))
    }

    /** After seven days without a new label the device would otherwise stay stuck on the old version. */
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
        // Signed as in the `signieren` job (openssl dgst -sha256 -sign), ECDSA test key.
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
