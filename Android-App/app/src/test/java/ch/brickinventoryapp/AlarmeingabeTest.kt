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
        // Leer ist die natuerliche Geste, einen Alarm loszuwerden. Ein halber
        // Anfang ist keine Zahl und damit dasselbe.
        for (roh in listOf("", "   ", "-", "abc", ",")) {
            assert(Alarmeingabe.zahl(roh) == null) {
                "\"$roh\" ergab ${Alarmeingabe.zahl(roh)} statt null"
            }
        }
    }

    @Test
    fun `ein Punkt am Ende ist eine Zahl, kein Loeschen`() {
        // ── Was ich zuerst falsch behauptet habe ─────────────────────────
        //
        // Hier stand „249." in der Loesch-Liste, und der Erklaertext in
        // Alarmeingabe.kt stuetzte darauf die Begruendung fuer die Ruhezeit.
        // Der CI-Lauf hat es gemeldet, und nachgemessen stimmt es nicht:
        // Double.parseDouble("249.") ist 249.0 — Java nimmt den Punkt am
        // Ende an. Die Webapp ebenso (parseFloat("249.") ist 249).
        //
        // Diese Pruefung steht jetzt hier, damit die richtige Antwort
        // festgehalten ist und nicht wieder jemand (ich) die plausible
        // annimmt.
        assert(Alarmeingabe.zahl("249.") == 249.0) {
            "249. ergab ${Alarmeingabe.zahl("249.")}"
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
        // Der Zwischenstand, auf den es ankommt, ist nicht „249." (das ist
        // eine gueltige Zahl, siehe oben), sondern „2" und „24": Wer „249"
        // tippen will, laeuft dort vorbei. Ohne Ruhezeit bliebe am Ende eine
        // Schwelle bei 2 stehen — und die meldet sofort, weil fast jedes Set
        // darueber liegt.
        //
        // 350 ms ist die Ruhe der Suche; eine Suche ZEIGT nur an, ein Alarm
        // LEGT ETWAS AN und bekommt deshalb mehr.
        assert(Alarmeingabe.RUHE_MS >= 500L) {
            "RUHE_MS steht auf ${Alarmeingabe.RUHE_MS} ms — zu kurz, um eine " +
                "Tippbewegung von \"2\" ueber \"24\" nach \"249\" zu ueberdauern."
        }
    }
}
