package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.util.otpauthAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What goes to the authenticator app: only `otpauth://totp|hotp/…`. Used to lie in
 * core-network; the rule needs no network, and this way feature-account does not know core-network.
 *
 * Counter-check (kotlinc and JUnit against Otpauth.kt, counter-checks/otpauth-jedes-schema.patch):
 *   the scheme check in otpauthAddress() removed → red “only otpauth goes to the
 *   authenticator app” (https let through)
 */
class OtpauthAddressTest {

    @Test
    fun `only otpauth goes to the authenticator app`() {
        val real = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP&issuer=BrickInventory"
        assertEquals(real, otpauthAddress(" $real "))
        assertEquals("OTPAUTH://hotp/x?secret=A", otpauthAddress("OTPAUTH://hotp/x?secret=A"))
        for (foreign in listOf("https://foreign.example/?secret=JBSWY3DP", "intent://totp/#Intent;scheme=otpauth;end",
                             "otpauth:totp/x?secret=A", "otpauth://evil/x?secret=A", "otpauth://totp/x y?secret=A",
                             "content://ch.brickinventoryapp.provider/x", "", null)) {
            assertNull("$foreign", otpauthAddress(foreign))
        }
    }
}
