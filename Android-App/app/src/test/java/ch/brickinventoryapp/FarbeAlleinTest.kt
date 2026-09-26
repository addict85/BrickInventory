package ch.brickinventoryapp

import org.junit.Test

/**
 * Keine Aussage haengt allein an der Farbe.
 *
 * ── Woher diese Regel kommt (Nachtrag 138) ─────────────────────────────────
 *
 * Marco, am 26.09.:
 *
 *   „Ok entschuldige ich habe eine rot gruen schwaeche. Deshalb sind labels
 *    mit scharf / unscharf fuer mich einfacher."
 *
 * Die Entschuldigung war an der falschen Stelle. Nicht das Auge ist der
 * Fehler, sondern eine Oberflaeche, die eine Information NUR in die Farbe
 * legt — beim Preisalarm stand „scharf" gegen „nicht mehr scharf" als gruen
 * gegen grau und sonst nirgends. Rot-Gruen-Schwaeche trifft rund acht Prozent
 * der Maenner; fuer sie stand die Aussage einfach nicht da.
 *
 * Danach wurde der ganze Baum durchgesehen. [LocalStatusFarben] ist die
 * Stelle, an der Farbe BEDEUTUNG traegt (Erfolg, Warnung, Fehler) — anders
 * als das Material-Schema, das Flaechen einfaerbt. Wer sie benutzt, sagt
 * damit etwas aus, und diese Aussage braucht einen zweiten Traeger.
 *
 * ── Was die Durchsicht ergeben hat ─────────────────────────────────────────
 *
 * Sieben Fundstellen in sechs Dateien. Sechs trugen ihre Aussage schon
 * doppelt:
 *
 *   MonitoringScreen      Job-Status  → Symbol (⏳ ✅ ❌ ⏸) und Statuswort
 *   SetupScreen           Scanner     → der Hinweistext wechselt mit
 *   BarcodeScannerScreen  Scanner     → derselbe Wechsel
 *   BarcodeScannerScreen  Taschenlampe→ die Knopfbeschriftung wechselt
 *   PortfolioChart        Entwicklung → Vorzeichen und Zahl
 *   SetDetailComponents   PnlBadge    → Vorzeichen und Zahl
 *
 * Die siebte nicht: RateLimitRow hatte drei Stufen (blau, gelb, rot), und nur
 * die Farbe sagte, in welcher man steckt — gelb gegen rot ist genau das Paar,
 * das zusammenfaellt. Die Zahl steht zwar daneben, aber der Zweck der
 * Faerbung war der Blickfang, nicht die Auskunft. Sie hat jetzt ein Zeichen.
 *
 * ── Warum eine Liste und keine Suche nach „gibt es Text daneben" ───────────
 *
 * Ob ein Text die Aussage WIRKLICH traegt, sieht kein Muster. „⏳ running"
 * traegt sie, ein Text, der zufaellig daneben steht, nicht. Die Liste ist
 * deshalb eine Behauptung, die ein Mensch getroffen hat, und der Test haelt
 * nur fest, dass niemand eine NEUE Stelle hinzufuegt, ohne dieselbe Frage
 * gestellt zu haben.
 */
class FarbeAlleinTest {

    /** Die Dateien, deren Farb-Aussage nachweislich einen zweiten Traeger hat. */
    private val geprueft = setOf(
        "MonitoringScreen.kt",
        "MonitoringSections.kt",
        "SetupScreen.kt",
        "BarcodeScannerScreen.kt",
        "PortfolioChart.kt",
        "SetDetailComponents.kt",
    )

    @Test
    fun `wer Statusfarben benutzt, steht auf der geprueften Liste`() {
        val nutzer = Quellen.alle()
            .filter { Quellen.ohneKommentare(it.readText()).contains("LocalStatusFarben.current") }
            .map { it.name }
            .toSet()
        // Selbstnachweis: Findet die Suche ueberhaupt etwas? Ohne das waere
        // eine leere Menge immer eine Teilmenge der Liste — die Regel waere
        // fuer immer gruen, ohne je etwas anzusehen.
        assert(nutzer.size >= 5) {
            "Nur ${nutzer.size} Dateien benutzen LocalStatusFarben — Muster veraltet?"
        }

        val neu = (nutzer - geprueft).sorted()
        assert(neu.isEmpty()) {
            "Diese Dateien faerben neuerdings mit LocalStatusFarben:\n  " +
                neu.joinToString("\n  ") +
                "\nFarbe traegt dort BEDEUTUNG. Was sagt die Stelle jemandem, der " +
                "Rot und Gruen nicht unterscheidet? Gibt es einen zweiten Traeger " +
                "(Wort, Zeichen, Form), gehoert die Datei in `geprueft` — und wenn " +
                "nicht, gehoert er gebaut."
        }
        val weg = (geprueft - nutzer).sorted()
        assert(weg.isEmpty()) {
            "Diese Eintraege in `geprueft` faerben gar nicht mehr so: " +
                weg.joinToString(", ") + " — raus damit."
        }
    }

    /**
     * Die eine Stelle, die beim Durchsehen wirklich nur an der Farbe hing.
     *
     * Sie steht hier einzeln, weil die Liste oben nur sagt „jemand hat
     * hingesehen". Was dabei herauskam, muss auch halten.
     */
    @Test
    fun `die Kontingent-Zeile warnt nicht nur mit Farbe`() {
        val s = Quellen.ohneKommentare(Quellen.lies("ui/screens/MonitoringSections.kt"))
        val i = s.indexOf("private fun RateLimitRow(")
        assert(i > 0) { "RateLimitRow fehlt — Muster veraltet?" }
        val rumpf = s.substring(i, minOf(i + 1800, s.length))
        assert(rumpf.contains("val eng = pct >")) {
            "Die Zeile kennt die Schwelle nicht mehr als eigenen Wert."
        }
        // ⚠ ist das Warnzeichen. Als Escape geschrieben, damit die
        // Suche nicht daran scheitert, wie die Datei kodiert ist.
        assert(rumpf.contains("⚠") || rumpf.contains("\\u26A0")) {
            "Ohne Zeichen bleibt nur die Farbe — und gelb gegen rot ist genau " +
                "das Paar, das bei einer Rot-Gruen-Schwaeche zusammenfaellt."
        }
    }
}
