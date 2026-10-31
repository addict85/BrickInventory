package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.ui.fehlerTextBrauchtCode
import ch.brickinventoryapp.ui.fehlerTextId
import org.junit.Test

/**
 * Jede Fehlerursache bekommt einen eigenen Satz — ausgeführt, nicht gelesen.
 *
 * In Nachtrag 116 stand diese Prüfung noch als Textsuche in
 * `ErrorMessageLayerTest`: Sie sah nach, ob in `meldung()` für jede
 * `Fehlerart` ein `Fehlerart.X ->` VORKOMMT. Das findet einen vergessenen
 * Zweig, aber nicht, ob zwei Arten versehentlich denselben Text zeigen — und
 * es bricht, sobald jemand die Funktion umformuliert (genau das ist in 117
 * passiert).
 *
 * Möglich wurde der echte Test dadurch, dass die Zuordnung aus `meldung()`
 * herausgelöst ist: `fehlerTextId()` braucht keinen `Context` und ist damit
 * eine ganz normale Funktion. Die Lehre aus Punkt 1 der Durchsicht im Kleinen —
 * was schwer prüfbar ist, ist meistens nur mit etwas verwoben, das es nicht
 * braucht.
 */
class FehlerTexteTest {

    @Test
    fun `jede Fehlerart hat einen eigenen Text`() {
        val zuordnung = Fehlerart.entries.associateWith { fehlerTextId(it) }

        zuordnung.forEach { (art, id) ->
            assert(id != 0) { "$art hat keine Textressource" }
        }

        // UNBEKANNT und ein fehlendes `art` teilen sich absichtlich denselben
        // Text; alle anderen müssen unterscheidbar sein. Zwei Ursachen mit
        // demselben Satz wären für den Nutzer nicht zu trennen, und die
        // Unterscheidung ist der ganze Zweck der Aufzählung.
        val ohneUnbekannt = zuordnung.filterKeys { it != Fehlerart.UNBEKANNT }
        val doppelt = ohneUnbekannt.entries
            .groupBy { it.value }
            .filterValues { it.size > 1 }
            .values.map { gruppe -> gruppe.joinToString { it.key.name } }
        assert(doppelt.isEmpty()) {
            "Diese Fehlerarten zeigen denselben Text: ${doppelt.joinToString(" | ")}"
        }
    }

    @Test
    fun `ohne Angabe gilt der Unbekannt-Text`() {
        assert(fehlerTextId(null) == fehlerTextId(Fehlerart.UNBEKANNT)) {
            "null muss denselben Text liefern wie UNBEKANNT — sonst hängt die " +
                "Meldung davon ab, ob eine Ursache fehlt oder als unbekannt gemeldet wurde"
        }
    }

    @Test
    fun `nur der Serverfehler braucht den HTTP-Code`() {
        // getString() mit einem überzähligen Argument wirft nicht, sondern
        // liefert stillschweigend denselben Text — ein falsches `true` hier
        // fiele also nirgends auf. Umgekehrt zeigte ein falsches `false` beim
        // Serverfehler den Platzhalter „%1$d" im Klartext.
        assert(fehlerTextBrauchtCode(Fehlerart.SERVER)) { "SERVER braucht den Code" }
        Fehlerart.entries.filter { it != Fehlerart.SERVER }.forEach {
            assert(!fehlerTextBrauchtCode(it)) { "$it braucht keinen Code" }
        }
        assert(!fehlerTextBrauchtCode(null))
    }
}
