package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.ui.mitTechnischerUrsache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * „Etwas ist schiefgelaufen" muss sagen, WAS schiefgelaufen ist.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Marcos Befund: „In der Android-App werden die Teile nicht angezeigt", dazu
 * die Meldung „Etwas ist schiefgelaufen". Das ist [Fehlerart.UNBEKANNT] — der
 * Auffangzweig in RepoBasis für JEDE geworfene Ausnahme.
 *
 * Ihre Ursache lag die ganze Zeit vor: `Result.Error(technisch = e.message)`.
 * NACHGEMESSEN wurde sie von niemandem gelesen — `grep -rn "\.technisch"` über
 * den Hauptbaum ergab null Treffer. Die Fehlersuche lief deshalb über mehrere
 * Runden im Kreis: Server geprüft (in Ordnung), Antwortform geprüft (passt),
 * Token geprüft (gültig) — und die App wusste die ganze Zeit, was los war.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Beide Richtungen, denn beide sind Regeln:
 *
 *  1. Bei UNBEKANNT wird die Ursache ANGEHÄNGT — sonst ist die Meldung wieder
 *     nichtssagend.
 *  2. Bei jeder anderen Ursache wird sie WEGGELASSEN. Nachtrag 116 hat
 *     englischen Bibliothekstext bewusst aus den Meldungen verbannt; „kein
 *     Netz" und „Sitzung abgelaufen" sind fertige Sätze, denen ein
 *     „Socket closed" nichts hinzufügt.
 */
class UrsacheSichtbarTest {

    @Test
    fun `bei unbekannter Ursache steht die technische Meldung dabei`() {
        val satz = mitTechnischerUrsache("Etwas ist schiefgelaufen", Fehlerart.UNBEKANNT, "unexpected end of stream")
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
            mitTechnischerUrsache("Etwas ist schiefgelaufen", Fehlerart.UNBEKANNT, null))
        assertEquals("Etwas ist schiefgelaufen",
            mitTechnischerUrsache("Etwas ist schiefgelaufen", Fehlerart.UNBEKANNT, "   "))
    }

    @Test
    fun `bei benannten Ursachen bleibt der Bibliothekstext draussen`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Ein Test, der nur
        // Punkt 1 prüft, wäre auch dann grün, wenn die Ursache ÜBERALL
        // angehängt würde — also genau die Regel bräche, gegen die
        // Nachtrag 116 gebaut ist.
        for (art in listOf(Fehlerart.NETZ, Fehlerart.ZEIT, Fehlerart.SERVER,
                           Fehlerart.SITZUNG_ABGELAUFEN, Fehlerart.LEERE_ANTWORT,
                           Fehlerart.NICHT_ANGEMELDET, Fehlerart.VERBINDUNG_BEENDET)) {
            assertEquals(
                "Bei $art darf kein englischer Bibliothekstext an den Satz geraten",
                "Keine Verbindung",
                mitTechnischerUrsache("Keine Verbindung", art, "Socket closed")
            )
        }
    }
}

/**
 * Ein zweiter QR-Anlauf darf keine Fehlermeldung erzeugen, wenn die Anmeldung
 * bereits steht.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn ich mich mit dem QR-Code in der App einloggen will, erscheint
 * ‚Ungültiges oder abgelaufenes Token'. Ich werde aber trotzdem eingeloggt."
 *
 * Beides zugleich kann nur heissen: Der Aufruf ging zweimal raus. Der QR-Token
 * ist einmalig (routes/auth.ts: `SET used_at = NOW() WHERE used_at IS NULL`) —
 * der erste Anlauf hat ihn eingelöst und angemeldet, der zweite fand ihn
 * verbraucht.
 */
class QrZweiterAnlaufTest {

    @Test
    fun `angemeldet - kein Fehler`() {
        assertEquals(null, ch.brickinventoryapp.ui.qrFehler(true, "Ungültiges oder abgelaufenes Token"))
    }

    @Test
    fun `nicht angemeldet - der Fehler bleibt`() {
        // Die Gegenrichtung, und sie ist die wichtigere: Würde die Meldung
        // IMMER unterdrückt, bliebe ein echter Fehlschlag (falscher Server,
        // abgelaufener Code beim ERSTEN Versuch) für den Nutzer unsichtbar —
        // er stünde vor einem Anmeldebildschirm, der nichts sagt.
        assertEquals("Ungültiges oder abgelaufenes Token",
            ch.brickinventoryapp.ui.qrFehler(false, "Ungültiges oder abgelaufenes Token"))
    }
}
