package ch.brickinventoryapp

import org.junit.Test

/**
 * Was der Kontofilter neu laedt, muss das Blickfeld auch mitschicken.
 *
 * ── Woher die Regel kommt ───────────────────────────────────────────────────
 * In der Webapp ist genau das ZWEIMAL schiefgegangen. `onScopeChange('gallery')`
 * laedt dort `loadGallery()` und `loadStats()` neu — und `loadStats()` rief
 * schlicht `api('GET', '/v1/stats')`. Wer auf „nur meine" stellte, sah eine
 * gefilterte Liste ueber ungefilterten Zahlen. Beim zweiten Fall
 * (enrichGalleryWithPrices) trug die AUFRUFKETTE den Filter, der Aufruf darin
 * aber nicht.
 *
 * ── Was hier geprueft wird ──────────────────────────────────────────────────
 * Die App macht es an allen 13 Stellen richtig. Diese Pruefung haelt das fest:
 * Jeder `repo.…`-Aufruf, den ein Lader hinter [setScope] erreicht, muss das
 * Blickfeld mitgeben — entweder direkt als `scopeFor(…)` oder ueber eine
 * Variable, die im selben Rumpf daraus belegt wurde (so macht es
 * loadValuation() mit `acc`).
 *
 * ── Warum gesucht und nicht aufgezaehlt ─────────────────────────────────────
 * WELCHE Lader der Filterwechsel anstoesst, steht in setScope() selbst und
 * wird von dort gelesen. Kommt eine Ansicht dazu oder laedt ein Wechsel etwas
 * Weiteres nach, ist es von selbst mitgeprueft.
 */
class KontofilterMitgebenTest {

    @Test
    fun `jeder Abruf hinter dem Kontofilter fuehrt das Blickfeld mit`() {
        val quellen = Quellen.unter("ui").associate { it.name to Quellen.ohneKommentare(it.readText()) }

        val wechsel = rumpf("setScope", quellen)
        assert(wechsel != null) { "setScope() nicht gefunden — umbenannt?" }

        // Was der Wechsel neu laedt.
        val lader = Regex("""\b(load[A-Z]\w*)\s*\(""").findAll(wechsel!!.second)
            .map { it.groupValues[1] }.toSet()
        // Selbstbeweis: Findet das Muster keine Lader, waere unten nichts zu
        // pruefen und der Test gruen, ohne etwas geprueft zu haben.
        assert(lader.size >= 6) { "Nur ${lader.size} Lader in setScope() gefunden — Muster veraltet?" }

        val fehlend = mutableListOf<String>()
        var geprueft = 0

        fun pruefe(name: String, tiefe: Int, gesehen: MutableSet<String>) {
            if (tiefe > 3 || !gesehen.add(name)) return
            val (datei, koerper) = rumpf(name, quellen) ?: return
            // Variablen, die im selben Rumpf aus scopeFor(...) belegt werden —
            // loadValuation() holt das Blickfeld einmal und reicht es dreimal
            // weiter. Ein Fenster ab der Aufrufstelle sieht das nicht, weil die
            // Zuweisung DAVOR steht.
            val blickfeldVars = Regex("""val (\w+)\s*=\s*scopeFor\(""")
                .findAll(koerper).map { it.groupValues[1] }.toSet()

            for (t in Regex("""repo\.(\w+)\.(\w+)\s*\(""").findAll(koerper)) {
                geprueft++
                val ab = t.range.first
                val bis = minOf(koerper.length, ab + 260)
                val stelle = koerper.substring(ab, bis)
                val traegt = stelle.contains("scopeFor(") || stelle.contains("accounts") ||
                    blickfeldVars.any { v -> Regex("""\W$v\W""").containsMatchIn(stelle) }
                if (!traegt) {
                    val zeile = koerper.substring(0, ab).count { it == '\n' } + 1
                    fehlend += "$datei: $name() -> repo.${t.groupValues[1]}.${t.groupValues[2]}() (Zeile ~$zeile im Rumpf)"
                }
            }
            for (m in Regex("""\b(load[A-Z]\w*)\s*\(""").findAll(koerper))
                if (m.groupValues[1] != name) pruefe(m.groupValues[1], tiefe + 1, gesehen)
        }

        for (l in lader) pruefe(l, 0, mutableSetOf())

        // Zweiter Selbstbeweis: Untersucht die Suche gar keine Aufrufe, waere
        // „nichts gefunden" wertlos. Genau dieser Fall ist beim Nachmessen
        // aufgetreten — ein falscher Pfadvergleich, null untersuchte Aufrufe,
        // und trotzdem eine gruene Meldung.
        assert(geprueft >= 10) {
            "Nur $geprueft repo-Aufrufe untersucht — dann sagt ein leeres Ergebnis nichts."
        }

        assert(fehlend.isEmpty()) {
            "Diese Abrufe haengen am Kontofilter, geben ihn aber nicht mit:\n  " +
                fehlend.joinToString("\n  ") +
                "\nSie werden beim Wechsel neu geladen und liefern trotzdem jedesmal " +
                "dasselbe — eine gefilterte Liste neben ungefilterten Zahlen."
        }
    }

    private companion object {
        /** Rumpf einer Funktion, in welcher Datei auch immer sie steht. */
        fun rumpf(name: String, quellen: Map<String, String>): Pair<String, String>? {
            for ((datei, src) in quellen) {
                val m = Regex("""fun (?:MainViewModel\.)?${Regex.escape(name)}\s*\(""").find(src) ?: continue
                // Erst die Parameterliste ueberspringen: Die erste '{' nach dem
                // Namen kann ein Vorgabewert sein.
                var i = src.indexOf('(', m.range.first)
                var tiefe = 1
                i++
                while (i < src.length && tiefe > 0) {
                    if (src[i] == '(') tiefe++ else if (src[i] == ')') tiefe--
                    i++
                }
                val start = src.indexOf('{', i)
                if (start < 0) continue
                var t2 = 1
                var e = start + 1
                while (e < src.length && t2 > 0) {
                    if (src[e] == '{') t2++ else if (src[e] == '}') t2--
                    e++
                }
                return datei to src.substring(m.range.first, e)
            }
            return null
        }
    }
}
