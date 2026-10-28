package ch.brickinventoryapp

import org.junit.Test

/**
 * Wer darf welches Feld von `AppUiState` beschreiben?
 *
 * Der gemeinsame Zustand liegt in der Sitzung (ui/Sitzung.kt) und wird nur
 * über `aendere { it.copy(…) }` geschrieben. Jeder Bereich hält seinen
 * eigenen Zustand privat — daran kommt ohnehin niemand. Hier steht, wer in
 * den GEMEINSAMEN schreiben darf und welche Felder; ein neuer Schreiber oder
 * ein neues Feld fällt auf, statt still einen zweiten Weg zu öffnen.
 *
 * Gegenproben (28.10.2026, gemessen):
 *   A  in GalerieViewModel.loadSets() `dienste.sitzung.aendere { it }`
 *      ergänzt → rot „nur die bekannten Stellen schreiben …“
 *   B  in FinanzViewModel `priceCondition` mitgeschrieben → rot, derselbe Fall
 */
class StateDomainBoundaryTest {

    /** Datei → Felder, die sie im gemeinsamen Zustand setzen darf. */
    private val erlaubt = mapOf(
        // Sitzung beginnen und beenden, Design, Sprache, Serverstart.
        "AppViewModel.kt" to setOf("appTheme", "serverUrl", "isLoggedIn", "authToken", "isAdmin",
                                   "currency", "language", "startupStatus"),
        "Sitzung.kt" to setOf("currency", "priceCondition", "defaultPriceCondition",
                              "userDefaultCondition", "appTheme"),
        "AnmeldungViewModel.kt" to setOf("isLoggedIn", "isAdmin"),
        "EinstellungenViewModel.kt" to setOf("currency", "priceCondition"),
        // Die Bewertung nennt die Währung des Servers.
        "FinanzViewModel.kt" to setOf("currency"),
    )

    @Test
    fun `nur die bekannten Stellen schreiben den gemeinsamen Zustand, und nur ihre Felder`() {
        val aufruf = Regex("""\baendere\s*\{\s*it\.copy\(""")
        val fehler = mutableListOf<String>()
        var gefunden = 0
        for (datei in Quellen.alle()) {
            val src = Quellen.ohneKommentare(datei.readText())
            for (m in aufruf.findAll(src)) {
                gefunden++
                val felder = erlaubt[datei.name]
                if (felder == null) {
                    fehler += "${datei.name}: schreibt den gemeinsamen Zustand"
                    continue
                }
                // Die Argumente bis zur schliessenden Klammer von copy(.
                var i = m.range.last + 1
                var tiefe = 1
                while (i < src.length && tiefe > 0) {
                    if (src[i] == '(') tiefe++ else if (src[i] == ')') tiefe--
                    i++
                }
                val args = src.substring(m.range.last + 1, i - 1)
                for (f in Regex("""(\w+)\s*=""").findAll(args).map { it.groupValues[1] }) {
                    if (f !in felder) fehler += "${datei.name}: setzt $f"
                }
            }
            // Auch ohne `it.copy(`: Ein anderes aendere{} auf der Sitzung schriebe am Muster vorbei.
            if (datei.name !in erlaubt && Regex("""sitzung\.aendere\b""").containsMatchIn(src)) {
                fehler += "${datei.name}: ruft sitzung.aendere"
            }
        }
        assert(gefunden >= 10) { "Nur $gefunden Schreibstellen gefunden — Muster veraltet?" }
        assert(fehler.distinct().isEmpty()) {
            "Der gemeinsame Zustand wird an unerwarteter Stelle beschrieben:\n  " +
                fehler.distinct().joinToString("\n  ") +
                "\nGehört das Feld einem Bereich, zieht es in dessen eigenen Zustand; " +
                "sonst die Liste oben bewusst erweitern."
        }
    }
}
