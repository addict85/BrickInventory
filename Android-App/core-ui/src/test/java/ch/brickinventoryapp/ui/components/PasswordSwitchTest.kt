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
 *   password-repeat-unchecked  repetition check removed → red „a different repetition …“
 *   password-current-always-required  `current != null &&` removed → red „without a current field …“
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

    @Test
    fun `without a current field only the new password and its repetition count`() {
        assertEquals(listOf(NEW), passwordSwitchError(null, "", ""))
        assertEquals(emptyList<PasswordFieldError>(), passwordSwitchError(null, "zwoelf-zeichen", "zwoelf-zeichen"))
    }
}
