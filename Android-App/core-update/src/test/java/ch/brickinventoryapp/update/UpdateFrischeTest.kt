package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UpdateBeschreibung
import ch.brickinventoryapp.update.util.UpdateFrische
import ch.brickinventoryapp.update.util.UpdateStand
import ch.brickinventoryapp.update.util.UpdateStandAblage
import ch.brickinventoryapp.update.util.anzubietendeFassung
import ch.brickinventoryapp.update.util.gepruefteBeschreibung
import ch.brickinventoryapp.update.util.pruefeFrische
import ch.brickinventoryapp.update.util.quelleVeraltet
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Frische der Update-Beschreibung: Wer Schreibrecht am Repository hat,
 * kann eine ältere, echt signierte version-signiert.json wieder hochladen. Die App
 * merkt sich den höchsten gesehenen Stand und meldet eine ältere oder abgelaufene
 * Beschreibung, statt „aktuell“ zu sagen.
 *
 * Gegenproben:
 *   A  in bewerteFrische() die Zeile mit `gesehen != null && …` entfernt → rot
 *      „eine aeltere echt signierte Beschreibung meldet ein Zurueckhalten“;
 *      gegenproben/update-zurueckgehalten.patch
 *   B  in bewerteFrische() `|| b.gueltigBis <= jetztSek` entfernt → rot „eine
 *      abgelaufene oder fristlose Beschreibung ist nie aktuell“;
 *      gegenproben/update-ohne-frist.patch
 *   C  in pruefeFrische() den Stand auch ohne AKTUELL fortgeschrieben → rot
 *      „eine abgelaufene oder fristlose …“ (eine abgelaufene setzte die Messlatte)
 *   D  in anzubietendeFassung() die Bedingung
 *      `frische == UpdateFrische.AKTUELL &&` gestrichen → rot „aus einer
 *      zurueckgesetzten oder abgelaufenen Beschreibung wird nichts angeboten“;
 *      gegenproben/update-angebot-trotz-zuruecksetzen.patch
 */
class UpdateFrischeTest {

    private class Ablage(var stand: UpdateStand? = null) : UpdateStandAblage {
        override suspend fun updateStand() = stand
        override suspend fun merkeUpdateStand(stand: UpdateStand) { this.stand = stand }
    }

    private val tag = 86_400L
    private val jetzt = 1_793_750_400L // 4. November 2026

    private fun beschreibung(code: Int, ausgestellt: Long = jetzt - tag, gueltig: Long = 30 * tag) =
        UpdateBeschreibung(versionCode = code, versionName = "1.$code", apkUrl = "https://x/a.apk",
            ausgestellt = ausgestellt, gueltigBis = if (ausgestellt > 0) ausgestellt + gueltig else 0)

    private fun pruefe(ablage: Ablage, b: UpdateBeschreibung, laufend: Int = 100, um: Long = jetzt) =
        runBlocking { pruefeFrische(ablage, b, laufend, um) }

    @Test
    fun `eine frische Beschreibung gilt und hebt die Messlatte`() {
        val ablage = Ablage()
        assertEquals(UpdateFrische.AKTUELL, pruefe(ablage, beschreibung(120)))
        assertEquals(UpdateStand(120, jetzt - tag), ablage.stand)
        // Dieselbe Fassung, später neu signiert (Auffrischen), gilt ebenso.
        assertEquals(UpdateFrische.AKTUELL, pruefe(ablage, beschreibung(120, ausgestellt = jetzt)))
        assertEquals(UpdateStand(120, jetzt), ablage.stand)
        assertFalse(quelleVeraltet(UpdateFrische.AKTUELL))
        assertFalse("Vor der ersten Prüfung gibt es nichts zu melden", quelleVeraltet(null))
    }

    @Test
    fun `eine aeltere echt signierte Beschreibung meldet ein Zurueckhalten`() {
        val ablage = Ablage(UpdateStand(120, jetzt - tag))
        assertEquals("Ältere Fassung", UpdateFrische.ZURUECKGESETZT, pruefe(ablage, beschreibung(110, ausgestellt = jetzt - 5 * tag)))
        assertEquals("Dieselbe Fassung, früher signiert", UpdateFrische.ZURUECKGESETZT,
            pruefe(ablage, beschreibung(120, ausgestellt = jetzt - 2 * tag)))
        assertEquals("Die Messlatte sinkt nicht", UpdateStand(120, jetzt - tag), ablage.stand)
        assertTrue(quelleVeraltet(UpdateFrische.ZURUECKGESETZT))
        // Auch ohne gemerkten Stand: älter als die installierte Fassung.
        assertEquals(UpdateFrische.ZURUECKGESETZT, pruefe(Ablage(), beschreibung(90), laufend = 100))
    }

    @Test
    fun `eine abgelaufene oder fristlose Beschreibung ist nie aktuell`() {
        val ablage = Ablage()
        assertEquals("Nach gueltigBis", UpdateFrische.ABGELAUFEN,
            pruefe(ablage, beschreibung(120, ausgestellt = jetzt - 31 * tag)))
        assertEquals("Ohne Frist (Beschreibung vor sec10)", UpdateFrische.ABGELAUFEN,
            pruefe(ablage, beschreibung(120, ausgestellt = 0)))
        assertNull("Eine abgelaufene setzt keine Messlatte", ablage.stand)
        assertTrue(quelleVeraltet(UpdateFrische.ABGELAUFEN))
    }

    /** Sonst hielte eine ältere, echt signierte Beschreibung auf einer verwundbaren Zwischenfassung fest. */
    @Test
    fun `aus einer zurueckgesetzten oder abgelaufenen Beschreibung wird nichts angeboten`() {
        val neu = beschreibung(120)
        assertEquals(neu, anzubietendeFassung(neu, pruefe(Ablage(), neu), laufend = 100))
        assertNull("Nicht neuer als die laufende", anzubietendeFassung(beschreibung(100), UpdateFrische.AKTUELL, 100))

        // Gesehen wurde schon 130; jemand spielt die echt signierte 120 wieder ein.
        val zurueck = Ablage(UpdateStand(130, jetzt - tag))
        val alt = beschreibung(120, ausgestellt = jetzt - 5 * tag)
        assertNull("Zurückgesetzt", anzubietendeFassung(alt, pruefe(zurueck, alt), laufend = 100))

        val abgelaufen = beschreibung(120, ausgestellt = jetzt - 31 * tag)
        assertNull("Abgelaufen", anzubietendeFassung(abgelaufen, pruefe(Ablage(), abgelaufen), laufend = 100))
    }

    @Test
    fun `Frist und Ausstellung kommen aus der signierten Beschreibung`() {
        // Signiert wie im Job `signieren` (openssl dgst -sha256 -sign), ECDSA-Testschlüssel.
        val zert = Base64.getDecoder().decode(ZERT)
        val b = gepruefteBeschreibung("""{"daten":"$DATEN","signatur":"$SIG"}""", listOf(zert), emptyList())
        assertNotNull(b)
        assertEquals(1_793_750_400L, b!!.ausgestellt)
        assertEquals(1_793_750_400L + 30 * tag, b.gueltigBis)
        assertEquals(UpdateFrische.AKTUELL, pruefe(Ablage(), b, laufend = 200_001_400, um = b.ausgestellt + tag))
        assertEquals(UpdateFrische.ABGELAUFEN, pruefe(Ablage(), b, laufend = 200_001_400, um = b.gueltigBis))
    }

    private companion object {
        const val ZERT = "MIIBhDCCASugAwIBAgIUOxM5gBxl0qitzzAFYNEQvBBaXO0wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBGcmlzY2hlMCAXDTI2MTEwNDA2MDc1OFoYDzIxMjYxMDExMDYwNzU4WjAXMRUwEwYDVQQDDAxUZXN0IEZyaXNjaGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASwmLz2s28ezP9h5c7ao9/i17GGcJwibPmkt1uH8IYnWsZ1AGS4z0WASs9a7/WYN+EPEadvrWgfBKbDWk7whgsFo1MwUTAdBgNVHQ4EFgQU5lHEp3GPZFyo2KfX/GcKOp1wmh8wHwYDVR0jBBgwFoAU5lHEp3GPZFyo2KfX/GcKOp1wmh8wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBJ5bPnsYOM7h6uB+7+Ut8I7Sj18ygMWKwJNs5wwPiKIAIgcqkdXHKc9nbv9O5AG2XqdGSqd11gZlejQhylJOzrq/Q="
        const val DATEN = "eyJ2ZXJzaW9uQ29kZSI6MjAwMDAxNTAwLCJ2ZXJzaW9uTmFtZSI6IjEuMy4wIiwiY29tbWl0IjoiYWJjMTIzIiwiYXBrVXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2FkZGljdDg1L0JyaWNrSW52ZW50b3J5L3JlbGVhc2VzL2Rvd25sb2FkL2FuZHJvaWQtdjEuMy4wL0JyaWNrSW52ZW50b3J5LTIwMDAwMTUwMC5hcGsiLCJhcGtTaXplIjo0LCJhcGtTaGEyNTYiOiI5Zjg2ZDA4MTg4NGM3ZDY1OWEyZmVhYTBjNTVhZDAxNWEzYmY0ZjFiMmIwYjgyMmNkMTVkNmMxNWIwZjAwYTA4IiwiYXVzZ2VzdGVsbHQiOjE3OTM3NTA0MDAsImd1ZWx0aWdCaXMiOjE3OTYzNDI0MDB9"
        const val SIG = "MEQCIF+69viCc+QO92nr9EPancVYNxodogfnQ4kDg+qDe87qAiBs4aFtp8byDLtIbOFrd0/bCMCvDUu9hMzRyG++Q3nNvw=="
    }
}
