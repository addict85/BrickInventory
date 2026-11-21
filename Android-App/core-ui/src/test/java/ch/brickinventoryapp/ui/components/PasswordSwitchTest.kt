package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.components.PasswordFieldError.AKTUELL
import ch.brickinventoryapp.ui.components.PasswordFieldError.NEU
import ch.brickinventoryapp.ui.components.PasswordFieldError.WIEDERHOLUNG
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What "change password" marks on submit, in the order of the fields; the first
 * gets the cursor (account and start password).
 *
 * Counter-check (measured locally, JVM):
 *   passwort-wiederholung-ungeprueft  repetition check removed → red „verschiedene
 *                                     Wiederholung …“ and „leer …“
 */
class PasswordSwitchTest {

    @Test
    fun `empty the current and the new field are marked, a missing repetition too`() {
        assertEquals(listOf(AKTUELL, NEU), passwordSwitchError("", "", ""))
        assertEquals(listOf(AKTUELL, WIEDERHOLUNG), passwordSwitchError("", "zwoelf-zeichen", ""))
    }

    @Test
    fun `a too short new password is an error, a long one is not`() {
        assertEquals(listOf(NEU), passwordSwitchError("alt", "kurz", "kurz"))
        assertEquals(emptyList<PasswordFieldError>(), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeichen"))
    }

    @Test
    fun `a different repetition is an error`() {
        assertEquals(listOf(WIEDERHOLUNG), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeicheN"))
    }
}
