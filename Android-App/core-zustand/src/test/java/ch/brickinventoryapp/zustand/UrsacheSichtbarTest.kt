package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.zustand.ui.mitTechnischerUrsache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.zustand.ui.qrFehler

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
class UrsacheSichtbarTest {

    @Test
    fun `bei unbekannter Ursache steht die technische Meldung dabei`() {
        val satz = mitTechnischerUrsache("Etwas ist schiefgelaufen", Ergebnis.Error.Unbekannt("unexpected end of stream"))
        assertTrue(
            "Die technische Ursache fehlt — dann sagt die Meldung wieder nichts: $satz",
            satz.contains("unexpected end of stream")
        )
        assertTrue("Der verständliche Satz muss erhalten bleiben: $satz",
            satz.startsWith("Etwas ist schiefgelaufen"))
    }

    @Test
    fun `ohne Ursache bleibt der Satz unveraendert`() {
        // Kein technischer Text vorhanden: Es darf keine leere Klammer entstehen.
        assertEquals("Etwas ist schiefgelaufen",
            mitTechnischerUrsache("Etwas ist schiefgelaufen", Ergebnis.Error.Unbekannt(null)))
        assertEquals("Etwas ist schiefgelaufen",
            mitTechnischerUrsache("Etwas ist schiefgelaufen", Ergebnis.Error.Unbekannt("   ")))
    }

    @Test
    fun `bei benannten Ursachen bleibt der Bibliothekstext draussen`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Ein Test, der nur
        // Punkt 1 prüft, wäre auch dann grün, wenn die Ursache ÜBERALL
        // angehängt würde — also genau die Regel bräche, um die es geht.
        for (art in listOf(Ergebnis.Error.Netz("Socket closed"), Ergebnis.Error.Zeitueberschreitung,
                           Ergebnis.Error.Server(500), Ergebnis.Error.Abgewiesen(),
                           Ergebnis.Error.LeereAntwort("Socket closed"), Ergebnis.Error.Abgebrochen,
                           Ergebnis.Error.Klartext)) {
            // Netz und LeereAntwort tragen selbst einen technischen Text; die übrigen
            // stehen dabei, damit eine künftige Ursache mit Text hier auffällt.
            assertEquals(
                "Bei $art darf kein englischer Bibliothekstext an den Satz geraten",
                "Keine Verbindung",
                mitTechnischerUrsache("Keine Verbindung", art)
            )
        }
    }
}

/**
 * Ein zweiter QR-Anlauf darf keine Fehlermeldung erzeugen, wenn die Anmeldung
 * bereits steht.
 */
class QrZweiterAnlaufTest {

    @Test
    fun `angemeldet - kein Fehler`() {
        assertEquals(null, qrFehler(true, "Ungültiges oder abgelaufenes Token"))
    }

    @Test
    fun `nicht angemeldet - der Fehler bleibt`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Würde die Meldung
        // IMMER unterdrückt, bliebe ein echter Fehlschlag (falscher Server,
        // abgelaufener Code beim ERSTEN Versuch) für den Nutzer unsichtbar —
        // er stünde vor einem Anmeldebildschirm, der nichts sagt.
        assertEquals("Ungültiges oder abgelaufenes Token",
            qrFehler(false, "Ungültiges oder abgelaufenes Token"))
    }
}
