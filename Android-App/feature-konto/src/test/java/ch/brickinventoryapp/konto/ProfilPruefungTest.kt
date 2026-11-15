package ch.brickinventoryapp.konto

import ch.brickinventoryapp.konto.ui.screens.ProfilFeld.BENUTZERNAME
import ch.brickinventoryapp.konto.ui.screens.ProfilFeld.EMAIL
import ch.brickinventoryapp.konto.ui.screens.profilFehler
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was „Profil speichern“ markiert, bevor das Passwort abgefragt wird; das erste Feld
 * bekommt den Cursor.
 *
 * Gegenprobe (gemessen lokal, JVM):
 *   profil-email-ungeprueft  leere E-Mail nicht gemeldet → rot „leer …“
 */
class ProfilPruefungTest {

    @Test
    fun `leer fehlen Benutzername und E-Mail, in dieser Reihenfolge`() {
        assertEquals(listOf(BENUTZERNAME, EMAIL), profilFehler(" ", ""))
        assertEquals(listOf(EMAIL), profilFehler("anna", ""))
    }

    @Test
    fun `ausgefuellt fehlt nichts`() {
        assertEquals(emptyList<Any>(), profilFehler("anna", "anna@example.org"))
    }
}
