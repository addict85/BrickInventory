package ch.brickinventoryapp

import ch.brickinventoryapp.alarm.Alarmeingabe
import org.junit.Test

/**
 * Was aus dem wird, was ins Schwellenfeld getippt wird.
 *
 * ── Warum das eine eigene Pruefung wert ist ─────────────────────────────────
 *
 * Diese Umrechnung traegt die teuerste Entscheidung des Preisalarms: `null`
 * heisst LOESCHEN. Jeder Text, der hier versehentlich zu `null` wird,
 * loescht einen Alarm, den jemand gerade eintippt — und zwar lautlos, denn
 * ein Loeschen ist kein Fehler.
 *
 * Seit Marcos Befund wird beim TIPPEN gespeichert, nicht mehr beim Verlassen
 * des Feldes. Damit laufen Zwischenstaende wie „249." durch diese Funktion,
 * die es vorher nie erreicht haben.
 */
class AlarmeingabeTest {

    @Test
    fun `eine gueltige Schwelle kommt als Zahl durch`() {
        assert(Alarmeingabe.zahl("200") == 200.0)
        assert(Alarmeingabe.zahl("249.90") == 249.90)
        assert(Alarmeingabe.zahl(" 249.90 ") == 249.90) { "Leerzeichen sollten egal sein" }
    }

    @Test
    fun `das Komma der deutschen Tastatur zaehlt als Punkt`() {
        // Ohne diese Zeile waere „249,90" keine Zahl, also ein Loeschen — der
        // Alarm verschwaende beim Eintippen.
        assert(Alarmeingabe.zahl("249,90") == 249.90) {
            "249,90 ergab ${Alarmeingabe.zahl("249,90")}"
        }
    }

    @Test
    fun `leer und halb getippt heissen loeschen`() {
        // Leer ist die natuerliche Geste, einen Alarm loszuwerden.
        // „249." und „-" sind Zwischenstaende; dass sie ebenfalls loeschen,
        // ist der Grund, warum die Ruhezeit nicht kurz sein darf.
        for (roh in listOf("", "   ", "249.", "-", "abc", ",")) {
            assert(Alarmeingabe.zahl(roh) == null) {
                "\"$roh\" ergab ${Alarmeingabe.zahl(roh)} statt null"
            }
        }
    }

    @Test
    fun `null und negativ sind kein Alarm`() {
        // Eine Schwelle von 0 ist keine Schwelle, sondern ein Alarm, der nie
        // oder immer meldet. Der Server lehnt sie ebenfalls ab
        // (pruefeEingabe in utils/preisalarm.ts).
        for (roh in listOf("0", "0.00", "-5", "-0.01")) {
            assert(Alarmeingabe.zahl(roh) == null) {
                "\"$roh\" ergab ${Alarmeingabe.zahl(roh)} statt null"
            }
        }
    }

    @Test
    fun `die Ruhezeit ist lang genug fuer einen Zwischenstand`() {
        // Sie muss laenger sein als eine Tippbewegung von „249" nach „249.90",
        // sonst traefe „249." den Server und loeschte, was gerade entsteht.
        // 350 ms ist die Ruhe der Suche; ein Alarm LEGT ETWAS AN und bekommt
        // mehr.
        assert(Alarmeingabe.RUHE_MS >= 500L) {
            "RUHE_MS steht auf ${Alarmeingabe.RUHE_MS} ms — zu kurz, um einen " +
                "Zwischenstand wie \"249.\" zu ueberleben."
        }
    }
}
