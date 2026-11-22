package ch.brickinventoryapp.account

import ch.brickinventoryapp.account.ui.screens.ProfileField.USERNAME
import ch.brickinventoryapp.account.ui.screens.ProfileField.EMAIL
import ch.brickinventoryapp.account.ui.screens.profileError
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What "Save profile" marks before the password is asked for; the first field
 * gets the cursor.
 *
 * Counter-check (measured locally, JVM):
 *   profil-email-ungeprueft  empty email not reported → red "leer …"
 */
class ProfileCheckTest {

    @Test
    fun `empty username and e-mail are missing, in this order`() {
        assertEquals(listOf(USERNAME, EMAIL), profileError(" ", ""))
        assertEquals(listOf(EMAIL), profileError("anna", ""))
    }

    @Test
    fun `filled in nothing is missing`() {
        assertEquals(emptyList<Any>(), profileError("anna", "anna@example.org"))
    }
}
