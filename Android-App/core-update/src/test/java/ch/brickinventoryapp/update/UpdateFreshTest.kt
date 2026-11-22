package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UpdateDescription
import ch.brickinventoryapp.update.util.UpdateFresh
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
import ch.brickinventoryapp.update.util.checkFresh
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.offerableVersion
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
 *   A  the line with `seen != null && …` removed from valueFresh() → red
 *      „an older genuinely signed description reports a withholding“;
 *      counter-checks/update-zurueckgehalten.patch
 *   B  `|| b.validUntil <= nowSec` removed from valueFresh() → red „eine abgelaufene oder fristlose Beschreibung ist nie aktuell“
 * ;
 *      counter-checks/update-ohne-frist.patch
 *   C  in checkFresh() the state advanced even without AKTUELL → red
 *      „eine abgelaufene oder fristlose …“ (an expired one moved the benchmark)
 *   D  the condition
 *      `freshness != UpdateFresh.RESET &&` removed from offerableVersion() → red „aus einer zurueckgesetzten Beschreibung wird nichts angeboten“
 * ;
 *      counter-checks/update-angebot-trotz-zuruecksetzen.patch
 *   E  offerableVersion() requires AKTUELL again → red „eine abgelaufene, neuere Beschreibung wird mit Hinweis angeboten“
 * ; counter-checks/update-abgelaufen-ohne-angebot.patch
 */
class UpdateFreshTest {

    private class Store(var state: UpdateStatus? = null) : UpdateStatusStore {
        override suspend fun updateStatus() = state
        override suspend fun rememberUpdateStatus(state: UpdateStatus) { this.state = state }
    }

    private val tag = 86_400L
    private val now = 1_793_750_400L // 4. November 2026

    private fun description(code: Int, issued: Long = now - tag, valid: Long = 30 * tag) =
        UpdateDescription(versionCode = code, versionName = "1.$code", apkUrl = "https://x/a.apk",
            issued = issued, validUntil = if (issued > 0) issued + valid else 0)

    private fun check(store: Store, b: UpdateDescription, running: Int = 100, um: Long = now) =
        runBlocking { checkFresh(store, b, running, um) }

    @Test
    fun `a fresh description applies and raises the bar`() {
        val store = Store()
        assertEquals(UpdateFresh.CURRENT, check(store, description(120)))
        assertEquals(UpdateStatus(120, now - tag), store.state)
        // The same version, re-signed later (refresh), counts the same way.
        assertEquals(UpdateFresh.CURRENT, check(store, description(120, issued = now)))
        assertEquals(UpdateStatus(120, now), store.state)
        assertFalse(sourceStale(UpdateFresh.CURRENT))
        assertFalse("before the first check there is nothing to report", sourceStale(null))
    }

    @Test
    fun `an older genuinely signed description reports a withholding`() {
        val store = Store(UpdateStatus(120, now - tag))
        assertEquals("older version", UpdateFresh.RESET, check(store, description(110, issued = now - 5 * tag)))
        assertEquals("the same version, signed earlier", UpdateFresh.RESET,
            check(store, description(120, issued = now - 2 * tag)))
        assertEquals("the bar does not drop", UpdateStatus(120, now - tag), store.state)
        assertTrue(sourceStale(UpdateFresh.RESET))
        // Even without a remembered state: older than the installed version.
        assertEquals(UpdateFresh.RESET, check(Store(), description(90), running = 100))
    }

    @Test
    fun `an expired or deadline-less description is never current`() {
        val store = Store()
        assertEquals("after gueltigBis", UpdateFresh.EXPIRED,
            check(store, description(120, issued = now - 31 * tag)))
        assertEquals("without a deadline (older description)", UpdateFresh.EXPIRED,
            check(store, description(120, issued = 0)))
        assertNull("an expired one sets no bar", store.state)
        assertTrue(sourceStale(UpdateFresh.EXPIRED))
    }

    /** Otherwise an older, genuinely signed description would hold on a vulnerable intermediate version. */
    @Test
    fun `nothing is offered from a reset description`() {
        val newValue = description(120)
        assertEquals(newValue, offerableVersion(newValue, check(Store(), newValue), running = 100))
        assertNull("not newer than the running one", offerableVersion(description(100), UpdateFresh.CURRENT, 100))

        // 130 was already seen; someone replays the genuinely signed 120.
        val back = Store(UpdateStatus(130, now - tag))
        val old = description(120, issued = now - 5 * tag)
        assertNull("reset", offerableVersion(old, check(back, old), running = 100))
        // Even expired, a description below the seen one stays rolled back.
        val oldAndExpired = description(120, issued = now - 40 * tag)
        assertNull("expired and older", offerableVersion(oldAndExpired, check(back, oldAndExpired), running = 100))
    }

    /** After seven days without a new label the device would otherwise stay stuck on the old version. */
    @Test
    fun `an expired, newer description is offered with a hint`() {
        val store = Store(UpdateStatus(110, now - 40 * tag))
        val expired = description(120, issued = now - 31 * tag)
        val freshness = check(store, expired)
        assertEquals(UpdateFresh.EXPIRED, freshness)
        assertEquals(expired, offerableVersion(expired, freshness, running = 100))
        assertTrue("the hint “there could be something newer” stays", sourceStale(freshness))
        assertEquals("the bar stays", UpdateStatus(110, now - 40 * tag), store.state)
        assertNull("not newer than the running one", offerableVersion(expired, freshness, running = 120))
    }

    @Test
    fun `deadline and issue come from the signed description`() {
        // Signed as in the `sign` job (openssl dgst -sha256 -sign), ECDSA test key.
        val key = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(CERT).inputStream()).publicKey.encoded
        val b = checkedDescription("""{"daten":"$DATA","beschreibungssignatur":"$SIG"}""", listOf(key))
        assertNotNull(b)
        assertEquals(1_793_750_400L, b!!.issued)
        assertEquals(1_793_750_400L + 30 * tag, b.validUntil)
        assertEquals(UpdateFresh.CURRENT, check(Store(), b, running = 200_001_400, um = b.issued + tag))
        assertEquals(UpdateFresh.EXPIRED, check(Store(), b, running = 200_001_400, um = b.validUntil))
    }

    private companion object {
        const val CERT = "MIIBhDCCASugAwIBAgIUOxM5gBxl0qitzzAFYNEQvBBaXO0wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBGcmlzY2hlMCAXDTI2MTEwNDA2MDc1OFoYDzIxMjYxMDExMDYwNzU4WjAXMRUwEwYDVQQDDAxUZXN0IEZyaXNjaGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASwmLz2s28ezP9h5c7ao9/i17GGcJwibPmkt1uH8IYnWsZ1AGS4z0WASs9a7/WYN+EPEadvrWgfBKbDWk7whgsFo1MwUTAdBgNVHQ4EFgQU5lHEp3GPZFyo2KfX/GcKOp1wmh8wHwYDVR0jBBgwFoAU5lHEp3GPZFyo2KfX/GcKOp1wmh8wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBJ5bPnsYOM7h6uB+7+Ut8I7Sj18ygMWKwJNs5wwPiKIAIgcqkdXHKc9nbv9O5AG2XqdGSqd11gZlejQhylJOzrq/Q="
        const val DATA = "eyJ2ZXJzaW9uQ29kZSI6MjAwMDAxNTAwLCJ2ZXJzaW9uTmFtZSI6IjEuMy4wIiwiY29tbWl0IjoiYWJjMTIzIiwiYXBrVXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2FkZGljdDg1L0JyaWNrSW52ZW50b3J5L3JlbGVhc2VzL2Rvd25sb2FkL2FuZHJvaWQtdjEuMy4wL0JyaWNrSW52ZW50b3J5LTIwMDAwMTUwMC5hcGsiLCJhcGtTaXplIjo0LCJhcGtTaGEyNTYiOiI5Zjg2ZDA4MTg4NGM3ZDY1OWEyZmVhYTBjNTVhZDAxNWEzYmY0ZjFiMmIwYjgyMmNkMTVkNmMxNWIwZjAwYTA4IiwiYXVzZ2VzdGVsbHQiOjE3OTM3NTA0MDAsImd1ZWx0aWdCaXMiOjE3OTYzNDI0MDB9"
        const val SIG = "MEQCIF+69viCc+QO92nr9EPancVYNxodogfnQ4kDg+qDe87qAiBs4aFtp8byDLtIbOFrd0/bCMCvDUu9hMzRyG++Q3nNvw=="
    }
}
