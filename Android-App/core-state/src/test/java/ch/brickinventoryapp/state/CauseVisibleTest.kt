package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.state.ui.withTechnicalCause
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.session.qrError

/**
 * „Etwas ist schiefgelaufen" muss sagen, WAS schiefgelaufen ist.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Beide Richtungen, denn beide sind Regeln:
 *
 *  1. Bei UNBEKANNT wird die Ursache ANGEHÄNGT — sonst ist die Meldung wieder
 *     nichtssagend.
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
        // Kein technischer Text vorhanden: Es darf keine leere Klammer entstehen.
        assertEquals("Etwas ist schiefgelaufen",
            withTechnicalCause("Etwas ist schiefgelaufen", Ergebnis.Fehler.Unbekannt(null)))
        assertEquals("Etwas ist schiefgelaufen",
            withTechnicalCause("Etwas ist schiefgelaufen", Ergebnis.Fehler.Unbekannt("   ")))
    }

    @Test
    fun `with named causes the library text stays out`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Ein Test, der nur
        // Punkt 1 prüft, wäre auch dann grün, wenn die Ursache ÜBERALL
        // angehängt würde — also genau die Regel bräche, um die es geht.
        for (art in listOf(Ergebnis.Fehler.Netz("Socket closed"), Ergebnis.Fehler.Zeitueberschreitung,
                           Ergebnis.Fehler.Server(500), Ergebnis.Fehler.Abgewiesen(),
                           Ergebnis.Fehler.LeereAntwort("Socket closed"), Ergebnis.Fehler.Abgebrochen,
                           Ergebnis.Fehler.Klartext)) {
            // Netz und LeereAntwort tragen selbst einen technischen Text; die übrigen
            // stehen dabei, damit eine künftige Ursache mit Text hier auffällt.
            assertEquals(
                "Bei $art darf kein englischer Bibliothekstext an den Satz geraten",
                "Keine Verbindung",
                withTechnicalCause("Keine Verbindung", art)
            )
        }
    }
}

/**
 * Ein zweiter QR-Anlauf darf keine Fehlermeldung erzeugen, wenn die Anmeldung
 * bereits steht.
 */
class QrSecondAttemptTest {

    @Test
    fun `signed in - no error`() {
        assertEquals(null, qrError(true, "Ungültiges oder abgelaufenes Token"))
    }

    @Test
    fun `not signed in - the error stays`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Würde die Meldung
        // IMMER unterdrückt, bliebe ein echter Fehlschlag (falscher Server,
        // abgelaufener Code beim ERSTEN Versuch) für den Nutzer unsichtbar —
        // er stünde vor einem Anmeldebildschirm, der nichts sagt.
        assertEquals("Ungültiges oder abgelaufenes Token",
            qrError(false, "Ungültiges oder abgelaufenes Token"))
    }
}
