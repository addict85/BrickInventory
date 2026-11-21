package ch.brickinventoryapp.account

import ch.brickinventoryapp.account.ui.screens.ProfileField.BENUTZERNAME
import ch.brickinventoryapp.account.ui.screens.ProfileField.EMAIL
import ch.brickinventoryapp.account.ui.screens.profileError
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was „Profil speichern“ markiert, bevor das Passwort abgefragt wird; das erste Feld
 * bekommt den Cursor.
 *
 * Gegenprobe (gemessen lokal, JVM):
 *   profil-email-ungeprueft  leere E-Mail nicht gemeldet → rot „leer …“
 */
class ProfileCheckTest {

    @Test
    fun `empty username and e-mail are missing, in this order`() {
        assertEquals(listOf(BENUTZERNAME, EMAIL), profileError(" ", ""))
        assertEquals(listOf(EMAIL), profileError("anna", ""))
    }

    @Test
    fun `filled in nothing is missing`() {
        assertEquals(emptyList<Any>(), profileError("anna", "anna@example.org"))
    }
}
