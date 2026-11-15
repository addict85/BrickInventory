package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.components.PasswortFeldFehler.AKTUELL
import ch.brickinventoryapp.ui.components.PasswortFeldFehler.NEU
import ch.brickinventoryapp.ui.components.PasswortFeldFehler.WIEDERHOLUNG
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
class PasswortWechselTest {

    @Test
    fun `leer ist das aktuelle und das neue Feld markiert, eine fehlende Wiederholung auch`() {
        assertEquals(listOf(AKTUELL, NEU), passwortWechselFehler("", "", ""))
        assertEquals(listOf(AKTUELL, WIEDERHOLUNG), passwortWechselFehler("", "zwoelf-zeichen", ""))
    }

    @Test
    fun `zu kurzes neues Passwort ist ein Fehler, ein langes nicht`() {
        assertEquals(listOf(NEU), passwortWechselFehler("alt", "kurz", "kurz"))
        assertEquals(emptyList<PasswortFeldFehler>(), passwortWechselFehler("alt", "zwoelf-zeichen", "zwoelf-zeichen"))
    }

    @Test
    fun `verschiedene Wiederholung ist ein Fehler`() {
        assertEquals(listOf(WIEDERHOLUNG), passwortWechselFehler("alt", "zwoelf-zeichen", "zwoelf-zeicheN"))
    }
}
