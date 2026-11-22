package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.state.ui.errorClass
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.errorTextId
import org.junit.Test

/**
 * Every error cause gets its own string — run, not read.
 *
 * Run instead of read: a text search for `Fehlerart.X ->` would find a
 * forgotten branch, but not whether two kinds show the same text, and it
 * would break as soon as someone rephrases the function.
 *
 * The real test became possible because the mapping has been
 * extracted from `message()`: `errorTextId()` needs no `Context` and is thus
 * a completely ordinary function. The lesson from point 1 of the small-scale
 * review — whatever is hard to test is usually just entangled with something it doesn't
 * need.
 *
 * Counter-checks:
 *   fehlertext-zeit-wie-netz      timeout mapped onto err_network → red
 *                                 „every error kind has its own text“
 *   fehlerklasse-401-unbekannt    Rejected in errorClass() mapped onto UNKNOWN → red
 *                                 „every error kind has a matching class“
 */
class ErrorTextsTest {

    /** One example per kind; [name] is exhaustive, a new kind breaks the build there. */
    private val examples = listOf(
        Outcome.Failure.Network(), Outcome.Failure.Timeout, Outcome.Failure.Cancelled,
        Outcome.Failure.EmptyResponse(), Outcome.Failure.Rejected(), Outcome.Failure.Server(500),
        Outcome.Failure.Plaintext, Outcome.Failure.Unknown(), Outcome.Failure.Refusal(),
    )

    private fun name(f: Outcome.Failure): String = when (f) {
        is Outcome.Failure.Network -> "Netz"
        Outcome.Failure.Timeout -> "Zeitueberschreitung"
        Outcome.Failure.Cancelled -> "Abgebrochen"
        is Outcome.Failure.EmptyResponse -> "EmptyResponse"
        is Outcome.Failure.Rejected -> "Abgewiesen"
        is Outcome.Failure.Server -> "Server"
        Outcome.Failure.Plaintext -> "Klartext"
        is Outcome.Failure.Unknown -> "Unbekannt"
        is Outcome.Failure.Refusal -> "Absage"
    }

    @Test
    fun `every error kind has its own text`() {
        assert(examples.map { name(it) }.toSet().size == 9) { "not every kind has an example" }
        val assignment = examples.associate { name(it) to errorTextId(it) }

        assignment.forEach { (kind, id) ->
            assert(id != 0) { "$kind has no text resource" }
        }

        // A break in the middle of the stream means the same thing to the user as no network
        // and therefore shares its text; all others must be distinguishable.
        // Two causes with the same text would be indistinguishable for the user.
        val withoutTeardown = assignment.filterKeys { it != "Abgebrochen" }
        val double = withoutTeardown.entries
            .groupBy { it.value }
            .filterValues { it.size > 1 }
            .values.map { group -> group.joinToString { it.key } }
        assert(double.isEmpty()) {
            "These error kinds show the same text: ${double.joinToString(" | ")}"
        }
    }

    @Test
    fun `a break in the stream shows the network text`() {
        assert(errorTextId(Outcome.Failure.Cancelled) == errorTextId(Outcome.Failure.Network())) {
            "cancelled was called “kein Netz” so far — a new sentence would be a change, not a rebuild"
        }
    }

    @Test
    fun `only the server error needs the HTTP code`() {
        // getString() with a surplus argument doesn't throw, but
        // silently returns the same text — a wrong argument here
        // would thus go unnoticed anywhere. Conversely, a missing one in the
        // server-error case showed the placeholder „%1$d“ as plain text.
        assert(errorTextArgument(Outcome.Failure.Server(503)) == 503) { "the server needs the status" }
        examples.filter { it !is Outcome.Failure.Server }.forEach {
            assert(errorTextArgument(it) == null) { "${name(it)} needs no code" }
        }
    }

    /**
     * Every kind ends up in the class whose advice fits it; a 5xx even with its own
     * text, a 4xx with text is information. For the counter-check, see the header
     * (fehlerklasse-401-unbekannt).
     */
    @Test
    fun `every error kind has a matching class`() {
        val expected = mapOf(
            "Netz" to ErrorClass.OFFLINE, "Zeitueberschreitung" to ErrorClass.OFFLINE,
            "Abgebrochen" to ErrorClass.OFFLINE, "Server" to ErrorClass.SERVER,
            "EmptyResponse" to ErrorClass.SERVER, "Abgewiesen" to ErrorClass.LOGIN,
            "Klartext" to ErrorClass.UNKNOWN, "Unbekannt" to ErrorClass.UNKNOWN, "Absage" to ErrorClass.UNKNOWN,
        )
        assert(expected.keys == examples.map { name(it) }.toSet()) { "new error kind without a class" }
        examples.forEach { f -> assert(errorClass(f) == expected[name(f)]) { "${name(f)} ergab ${errorClass(f)}" } }
        assert(errorClass(Outcome.Failure.Rejected("Satz")) == ErrorClass.LOGIN)
        assert(errorClass(Outcome.Failure.Server(503, "Satz")) == ErrorClass.SERVER)
        assert(errorClass(Outcome.Failure.Server(409, "Satz")) == ErrorClass.UNKNOWN)
        assert(errorClass(Outcome.Failure.Server(409)) == ErrorClass.SERVER)
    }
}
