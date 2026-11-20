package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.util.otpauthAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Was an die Authenticator-App geht: nur `otpauth://totp|hotp/…`. Lag früher in
 * core-netz; die Regel braucht kein Netz, und so kennt feature-konto core-netz nicht.
 *
 * Gegenprobe (kotlinc und JUnit gegen Otpauth.kt, gegenproben/otpauth-jedes-schema.patch):
 *   die Schema-Prüfung in otpauthAddress() entfernt → rot „an die Authenticator-App
 *   geht nur otpauth“ (https durchgelassen)
 */
class OtpauthAddressTest {

    @Test
    fun `an die Authenticator-App geht nur otpauth`() {
        val echt = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP&issuer=BrickInventory"
        assertEquals(echt, otpauthAddress(" $echt "))
        assertEquals("OTPAUTH://hotp/x?secret=A", otpauthAddress("OTPAUTH://hotp/x?secret=A"))
        for (fremd in listOf("https://fremd.example/?secret=JBSWY3DP", "intent://totp/#Intent;scheme=otpauth;end",
                             "otpauth:totp/x?secret=A", "otpauth://evil/x?secret=A", "otpauth://totp/x y?secret=A",
                             "content://ch.brickinventoryapp.provider/x", "", null)) {
            assertNull("$fremd", otpauthAddress(fremd))
        }
    }
}
