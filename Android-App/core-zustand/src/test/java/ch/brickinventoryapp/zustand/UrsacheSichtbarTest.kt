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
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Marcos Befund: „In der Android-App werden die Teile nicht angezeigt", dazu
 * die Meldung „Etwas ist schiefgelaufen". Das ist [Ergebnis.Error.Unbekannt] — der
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
        // angehängt würde — also genau die Regel bräche, gegen die
        // Nachtrag 116 gebaut ist.
        // Netz und LeereAntwort tragen selbst einen technischen Text; die übrigen
        // stehen dabei, damit eine künftige Ursache mit Text hier auffällt.
        for (art in listOf(Ergebnis.Error.Netz("Socket closed"), Ergebnis.Error.Zeitueberschreitung,
                           Ergebnis.Error.Server(500), Ergebnis.Error.Abgewiesen(),
                           Ergebnis.Error.LeereAntwort("Socket closed"), Ergebnis.Error.Abgebrochen,
                           Ergebnis.Error.Klartext)) {
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
