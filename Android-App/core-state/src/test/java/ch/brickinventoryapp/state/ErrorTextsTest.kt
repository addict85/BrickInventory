package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.errorClass
import ch.brickinventoryapp.state.ui.fehlerTextId
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis

/**
 * Jede Fehlerursache bekommt einen eigenen Satz — ausgeführt, nicht gelesen.
 *
 * Ausgeführt statt gelesen: Eine Textsuche nach `Fehlerart.X ->` fände einen
 * vergessenen Zweig, aber nicht, ob zwei Arten denselben Text zeigen, und sie
 * bräche, sobald jemand die Funktion umformuliert.
 *
 * Möglich wurde der echte Test dadurch, dass die Zuordnung aus `meldung()`
 * herausgelöst ist: `fehlerTextId()` braucht keinen `Context` und ist damit
 * eine ganz normale Funktion. Die Lehre aus Punkt 1 der Durchsicht im Kleinen —
 * was schwer prüfbar ist, ist meistens nur mit etwas verwoben, das es nicht
 * braucht.
 *
 * Gegenproben:
 *   fehlertext-zeit-wie-netz      Zeitueberschreitung auf err_network gelegt → rot
 *                                 „every error kind has its own text“
 *   fehlerklasse-401-unbekannt    Abgewiesen in fehlerklasse() auf UNBEKANNT → rot
 *                                 „every error kind has a matching class“
 */
class ErrorTextsTest {

    /** Je Art ein Beispiel; [name] ist erschöpfend, eine neue Art bricht dort den Build. */
    private val examples = listOf(
        Ergebnis.Fehler.Netz(), Ergebnis.Fehler.Zeitueberschreitung, Ergebnis.Fehler.Abgebrochen,
        Ergebnis.Fehler.LeereAntwort(), Ergebnis.Fehler.Abgewiesen(), Ergebnis.Fehler.Server(500),
        Ergebnis.Fehler.Klartext, Ergebnis.Fehler.Unbekannt(), Ergebnis.Fehler.Absage(),
    )

    private fun name(f: Ergebnis.Fehler): String = when (f) {
        is Ergebnis.Fehler.Netz -> "Netz"
        Ergebnis.Fehler.Zeitueberschreitung -> "Zeitueberschreitung"
        Ergebnis.Fehler.Abgebrochen -> "Abgebrochen"
        is Ergebnis.Fehler.LeereAntwort -> "LeereAntwort"
        is Ergebnis.Fehler.Abgewiesen -> "Abgewiesen"
        is Ergebnis.Fehler.Server -> "Server"
        Ergebnis.Fehler.Klartext -> "Klartext"
        is Ergebnis.Fehler.Unbekannt -> "Unbekannt"
        is Ergebnis.Fehler.Absage -> "Absage"
    }

    @Test
    fun `every error kind has its own text`() {
        assert(examples.map { name(it) }.toSet().size == 9) { "Nicht jede Art hat ein Beispiel" }
        val zuordnung = examples.associate { name(it) to fehlerTextId(it) }

        zuordnung.forEach { (art, id) ->
            assert(id != 0) { "$art hat keine Textressource" }
        }

        // Ein Abriss mitten im Strom heisst für den Nutzer dasselbe wie kein Netz
        // und teilt sich darum dessen Satz; alle anderen müssen unterscheidbar sein.
        // Zwei Ursachen mit demselben Satz wären für den Nutzer nicht zu trennen.
        val withoutTeardown = zuordnung.filterKeys { it != "Abgebrochen" }
        val doppelt = withoutTeardown.entries
            .groupBy { it.value }
            .filterValues { it.size > 1 }
            .values.map { gruppe -> gruppe.joinToString { it.key } }
        assert(doppelt.isEmpty()) {
            "Diese Fehlerarten zeigen denselben Text: ${doppelt.joinToString(" | ")}"
        }
    }

    @Test
    fun `a break in the stream shows the network text`() {
        assert(fehlerTextId(Ergebnis.Fehler.Abgebrochen) == fehlerTextId(Ergebnis.Fehler.Netz())) {
            "Abgebrochen hiess bisher „kein Netz“ — ein neuer Satz wäre eine Änderung, kein Umbau"
        }
    }

    @Test
    fun `only the server error needs the HTTP code`() {
        // getString() mit einem überzähligen Argument wirft nicht, sondern
        // liefert stillschweigend denselben Text — ein falsches Argument hier
        // fiele also nirgends auf. Umgekehrt zeigte ein fehlendes beim
        // Serverfehler den Platzhalter „%1$d" im Klartext.
        assert(errorTextArgument(Ergebnis.Fehler.Server(503)) == 503) { "Server braucht den Status" }
        examples.filter { it !is Ergebnis.Fehler.Server }.forEach {
            assert(errorTextArgument(it) == null) { "${name(it)} braucht keinen Code" }
        }
    }

    /**
     * Jede Art landet in der Klasse, deren Rat zu ihr passt; ein 5xx auch mit eigenem
     * Satz, ein 4xx mit Satz ist eine Auskunft. Gegenprobe siehe Kopf
     * (fehlerklasse-401-unbekannt).
     */
    @Test
    fun `every error kind has a matching class`() {
        val erwartet = mapOf(
            "Netz" to Fehlerklasse.OFFLINE, "Zeitueberschreitung" to Fehlerklasse.OFFLINE,
            "Abgebrochen" to Fehlerklasse.OFFLINE, "Server" to Fehlerklasse.SERVER,
            "LeereAntwort" to Fehlerklasse.SERVER, "Abgewiesen" to Fehlerklasse.LOGIN,
            "Klartext" to Fehlerklasse.UNBEKANNT, "Unbekannt" to Fehlerklasse.UNBEKANNT, "Absage" to Fehlerklasse.UNBEKANNT,
        )
        assert(erwartet.keys == examples.map { name(it) }.toSet()) { "neue Fehlerart ohne Klasse" }
        examples.forEach { f -> assert(errorClass(f) == erwartet[name(f)]) { "${name(f)} ergab ${errorClass(f)}" } }
        assert(errorClass(Ergebnis.Fehler.Abgewiesen("Satz")) == Fehlerklasse.LOGIN)
        assert(errorClass(Ergebnis.Fehler.Server(503, "Satz")) == Fehlerklasse.SERVER)
        assert(errorClass(Ergebnis.Fehler.Server(409, "Satz")) == Fehlerklasse.UNBEKANNT)
        assert(errorClass(Ergebnis.Fehler.Server(409)) == Fehlerklasse.SERVER)
    }
}
