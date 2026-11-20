package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.components.PasswordFieldError.AKTUELL
import ch.brickinventoryapp.ui.components.PasswordFieldError.NEU
import ch.brickinventoryapp.ui.components.PasswordFieldError.WIEDERHOLUNG
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was „Passwort ändern“ beim Absenden markiert, in der Reihenfolge der Felder; das erste
 * bekommt den Cursor (Konto und Startpasswort).
 *
 * Gegenprobe (gemessen lokal, JVM):
 *   passwort-wiederholung-ungeprueft  Prüfung der Wiederholung entfernt → rot „verschiedene
 *                                     Wiederholung …“ und „leer …“
 */
class PasswordSwitchTest {

    @Test
    fun `leer ist das aktuelle und das neue Feld markiert, eine fehlende Wiederholung auch`() {
        assertEquals(listOf(AKTUELL, NEU), passwordSwitchError("", "", ""))
        assertEquals(listOf(AKTUELL, WIEDERHOLUNG), passwordSwitchError("", "zwoelf-zeichen", ""))
    }

    @Test
    fun `zu kurzes neues Passwort ist ein Fehler, ein langes nicht`() {
        assertEquals(listOf(NEU), passwordSwitchError("alt", "kurz", "kurz"))
        assertEquals(emptyList<PasswordFieldError>(), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeichen"))
    }

    @Test
    fun `verschiedene Wiederholung ist ein Fehler`() {
        assertEquals(listOf(WIEDERHOLUNG), passwordSwitchError("alt", "zwoelf-zeichen", "zwoelf-zeicheN"))
    }
}
