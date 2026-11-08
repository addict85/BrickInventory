package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.ui.Fehlerklasse
import ch.brickinventoryapp.zustand.ui.fehlerTextArgument
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import ch.brickinventoryapp.zustand.ui.fehlerTextId
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis

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
 *
 * Gegenproben:
 *   fehlertext-zeit-wie-netz      Zeitueberschreitung auf err_network gelegt → rot
 *                                 „jede Fehlerart hat einen eigenen Text“
 *   fehlerklasse-401-unbekannt    Abgewiesen in fehlerklasse() auf UNBEKANNT → rot
 *                                 „jede Fehlerart hat eine passende Klasse“
 */
class FehlerTexteTest {

    /** Je Art ein Beispiel; [name] ist erschöpfend, eine neue Art bricht dort den Build. */
    private val beispiele = listOf(
        Ergebnis.Error.Netz(), Ergebnis.Error.Zeitueberschreitung, Ergebnis.Error.Abgebrochen,
        Ergebnis.Error.LeereAntwort(), Ergebnis.Error.Abgewiesen(), Ergebnis.Error.Server(500),
        Ergebnis.Error.Klartext, Ergebnis.Error.Unbekannt(),
    )

    private fun name(f: Ergebnis.Error): String = when (f) {
        is Ergebnis.Error.Netz -> "Netz"
        Ergebnis.Error.Zeitueberschreitung -> "Zeitueberschreitung"
        Ergebnis.Error.Abgebrochen -> "Abgebrochen"
        is Ergebnis.Error.LeereAntwort -> "LeereAntwort"
        is Ergebnis.Error.Abgewiesen -> "Abgewiesen"
        is Ergebnis.Error.Server -> "Server"
        Ergebnis.Error.Klartext -> "Klartext"
        is Ergebnis.Error.Unbekannt -> "Unbekannt"
    }

    @Test
    fun `jede Fehlerart hat einen eigenen Text`() {
        assert(beispiele.map(::name).toSet().size == 8) { "Nicht jede Art hat ein Beispiel" }
        val zuordnung = beispiele.associate { name(it) to fehlerTextId(it) }

        zuordnung.forEach { (art, id) ->
            assert(id != 0) { "$art hat keine Textressource" }
        }

        // Ein Abriss mitten im Strom heisst für den Nutzer dasselbe wie kein Netz
        // und teilt sich darum dessen Satz; alle anderen müssen unterscheidbar sein.
        // Zwei Ursachen mit demselben Satz wären für den Nutzer nicht zu trennen.
        val ohneAbriss = zuordnung.filterKeys { it != "Abgebrochen" }
        val doppelt = ohneAbriss.entries
            .groupBy { it.value }
            .filterValues { it.size > 1 }
            .values.map { gruppe -> gruppe.joinToString { it.key } }
        assert(doppelt.isEmpty()) {
            "Diese Fehlerarten zeigen denselben Text: ${doppelt.joinToString(" | ")}"
        }
    }

    @Test
    fun `ein Abriss im Strom zeigt den Netz-Text`() {
        assert(fehlerTextId(Ergebnis.Error.Abgebrochen) == fehlerTextId(Ergebnis.Error.Netz())) {
            "Abgebrochen hiess bisher „kein Netz“ — ein neuer Satz wäre eine Änderung, kein Umbau"
        }
    }

    @Test
    fun `nur der Serverfehler braucht den HTTP-Code`() {
        // getString() mit einem überzähligen Argument wirft nicht, sondern
        // liefert stillschweigend denselben Text — ein falsches Argument hier
        // fiele also nirgends auf. Umgekehrt zeigte ein fehlendes beim
        // Serverfehler den Platzhalter „%1$d" im Klartext.
        assert(fehlerTextArgument(Ergebnis.Error.Server(503)) == 503) { "Server braucht den Status" }
        beispiele.filter { it !is Ergebnis.Error.Server }.forEach {
            assert(fehlerTextArgument(it) == null) { "${name(it)} braucht keinen Code" }
        }
    }

    /**
     * Jede Art landet in der Klasse, deren Rat zu ihr passt; ein 5xx auch mit eigenem
     * Satz, ein 4xx mit Satz ist eine Auskunft. Gegenprobe siehe Kopf
     * (fehlerklasse-401-unbekannt).
     */
    @Test
    fun `jede Fehlerart hat eine passende Klasse`() {
        val erwartet = mapOf(
            "Netz" to Fehlerklasse.OFFLINE, "Zeitueberschreitung" to Fehlerklasse.OFFLINE,
            "Abgebrochen" to Fehlerklasse.OFFLINE, "Server" to Fehlerklasse.SERVER,
            "LeereAntwort" to Fehlerklasse.SERVER, "Abgewiesen" to Fehlerklasse.ANMELDUNG,
            "Klartext" to Fehlerklasse.UNBEKANNT, "Unbekannt" to Fehlerklasse.UNBEKANNT,
        )
        assert(erwartet.keys == beispiele.map(::name).toSet()) { "neue Fehlerart ohne Klasse" }
        beispiele.forEach { f -> assert(fehlerklasse(f) == erwartet[name(f)]) { "${name(f)} ergab ${fehlerklasse(f)}" } }
        assert(fehlerklasse(Ergebnis.Error.Abgewiesen("Satz")) == Fehlerklasse.ANMELDUNG)
        assert(fehlerklasse(Ergebnis.Error.Server(503, "Satz")) == Fehlerklasse.SERVER)
        assert(fehlerklasse(Ergebnis.Error.Server(409, "Satz")) == Fehlerklasse.UNBEKANNT)
        assert(fehlerklasse(Ergebnis.Error.Server(409)) == Fehlerklasse.SERVER)
    }
}
