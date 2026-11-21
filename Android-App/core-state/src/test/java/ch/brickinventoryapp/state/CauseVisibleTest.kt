package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.state.ui.withTechnicalCause
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.session.qrError

/**
 * „Something went wrong“ has to say WHAT went wrong.
 *
 * ── What is checked here ───────────────────────────────────────────────────
 *
 * Both directions, because both are rules:
 *
 *  1. For UNBEKANNT the cause is APPENDED — otherwise the message is
 *     meaningless again.
 */
class CauseVisibleTest {

    @Test
    fun `with an unknown cause the technical message is included`() {
        val satz = withTechnicalCause("Etwas ist schiefgelaufen", Ergebnis.Fehler.Unbekannt("unexpected end of stream"))
        assertTrue(
            "Die technische Ursache fehlt — dann sagt die Meldung wieder nichts: $satz",
            satz.contains("unexpected end of stream")
        )
        assertTrue("Der verständliche Satz muss erhalten bleiben: $satz",
            satz.startsWith("Etwas ist schiefgelaufen"))
    }

    @Test
    fun `without a cause the sentence stays unchanged`() {
        // No technical text present: no empty parenthesis must result.
        assertEquals("Etwas ist schiefgelaufen",
            withTechnicalCause("Etwas ist schiefgelaufen", Ergebnis.Fehler.Unbekannt(null)))
        assertEquals("Etwas ist schiefgelaufen",
            withTechnicalCause("Etwas ist schiefgelaufen", Ergebnis.Fehler.Unbekannt("   ")))
    }

    @Test
    fun `with named causes the library text stays out`() {
        // The opposite direction, and it's the more important one: a test that only
        // checks point 1 would also be green if the cause were appended
        // EVERYWHERE — i.e. it would break exactly the rule this is about.
        for (art in listOf(Ergebnis.Fehler.Netz("Socket closed"), Ergebnis.Fehler.Zeitueberschreitung,
                           Ergebnis.Fehler.Server(500), Ergebnis.Fehler.Abgewiesen(),
                           Ergebnis.Fehler.LeereAntwort("Socket closed"), Ergebnis.Fehler.Abgebrochen,
                           Ergebnis.Fehler.Klartext)) {
            // Netz and LeereAntwort already carry a technical text themselves; the rest
            // are listed so a future cause with a text stands out here.
            assertEquals(
                "Bei $art darf kein englischer Bibliothekstext an den Satz geraten",
                "Keine Verbindung",
                withTechnicalCause("Keine Verbindung", art)
            )
        }
    }
}

/**
 * A second QR startup must not produce an error message if the sign-in
 * is already in place.
 */
class QrSecondAttemptTest {

    @Test
    fun `signed in - no error`() {
        assertEquals(null, qrError(true, "Ungültiges oder abgelaufenes Token"))
    }

    @Test
    fun `not signed in - the error stays`() {
        // The opposite direction, and it's the more important one: if the message
        // were ALWAYS suppressed, a real failure (wrong server,
        // expired code on the FIRST attempt) would stay invisible to the user —
        // they'd be looking at a sign-in screen that says nothing.
        assertEquals("Ungültiges oder abgelaufenes Token",
            qrError(false, "Ungültiges oder abgelaufenes Token"))
    }
}
