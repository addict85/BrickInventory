package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.components.PasswordFieldError.CURRENT
import ch.brickinventoryapp.ui.components.PasswordFieldError.NEW
import ch.brickinventoryapp.ui.components.PasswordFieldError.RETRY
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What "change password" marks on submit, in the order of the fields; the first
 * gets the cursor (account and start password).
 *
 * Counter-check (measured locally, JVM):
 *   passwort-wiederholung-ungeprueft  repetition check removed → red „verschiedene Wiederholung …“ and „leer …“
 */
class PasswordSwitchTest {

    @Test
    fun `empty the current and the new field are marked, a missing repetition too`() {
        assertEquals(listOf(CURRENT, NEW), passwordSwitchError("", "", ""))
        assertEquals(listOf(CURRENT, RETRY), passwordSwitchError("", "zwoelf-zeichen", ""))
    }

    @Test
    fun `a too short new password is an error, a long one is not`() {
        assertEquals(listOf(NEW), passwordSwitchError("alt", "kurz", "kurz"))
        assertEquals(emptyList<PasswordFieldError>(), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeichen"))
    }

    @Test
    fun `a different repetition is an error`() {
        assertEquals(listOf(RETRY), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeicheN"))
    }
}
