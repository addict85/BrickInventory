package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.errorClass
import ch.brickinventoryapp.state.ui.fehlerTextId
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis

/**
 * Every error cause gets its own string — run, not read.
 *
 * Run instead of read: a text search for `Fehlerart.X ->` would find a
 * forgotten branch, but not whether two kinds show the same text, and it
 * would break as soon as someone rephrases the function.
 *
 * The real test became possible because the mapping has been
 * extracted from `meldung()`: `fehlerTextId()` needs no `Context` and is thus
 * a completely ordinary function. The lesson from point 1 of the small-scale
 * review — whatever is hard to test is usually just entangled with something it doesn't
 * need.
 *
 * Counter-checks:
 *   fehlertext-zeit-wie-netz      timeout mapped onto err_network → red
 *                                 „every error kind has its own text“
 *   fehlerklasse-401-unbekannt    Abgewiesen in fehlerklasse() mapped onto UNBEKANNT → red
 *                                 „every error kind has a matching class“
 */
class ErrorTextsTest {

    /** One example per kind; [name] is exhaustive, a new kind breaks the build there. */
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

        // A break in the middle of the stream means the same thing to the user as no network
        // and therefore shares its text; all others must be distinguishable.
        // Two causes with the same text would be indistinguishable for the user.
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
        // getString() with a surplus argument doesn't throw, but
        // silently returns the same text — a wrong argument here
        // would thus go unnoticed anywhere. Conversely, a missing one in the
        // server-error case showed the placeholder „%1$d" as plain text.
        assert(errorTextArgument(Ergebnis.Fehler.Server(503)) == 503) { "Server braucht den Status" }
        examples.filter { it !is Ergebnis.Fehler.Server }.forEach {
            assert(errorTextArgument(it) == null) { "${name(it)} braucht keinen Code" }
        }
    }

    /**
     * Every kind ends up in the class whose advice fits it; a 5xx even with its own
     * text, a 4xx with text is information. For the counter-check, see the header
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
