package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein Listenfilter gehoert in den Zustand der Liste, nicht in den Aufruf.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Die Galerie haelt Suchtext, Thema und Sortierung in GalleryUiState; JEDER
 * Lader liest sie dort. Die Teileliste hielt ihren Suchtext in einer lokalen
 * Variablen des Bildschirms (`var searchQuery by rememberSaveable`) und gab
 * ihn als Argument mit — `loadParts(search = …)`.
 *
 * Damit kannte den Filter nur, wer aus dem Suchfeld heraus lud. Alle anderen
 * Wege luden ungefiltert:
 *
 *   - `onLoadMore(page)` holte Seite 2 des GANZEN Bestands und haengte sie an
 *     eine gefilterte Seite 1; `partsTotal` kam aus derselben ungefilterten
 *     Abfrage, der Endlos-Scroll rechnete also gegen eine fremde Zahl.
 *   - `onRefresh` gab ausdruecklich `search = null` — die Liste sprang auf den
 *     ganzen Bestand, waehrend das Suchfeld daneben den Text weiter zeigte.
 *   - Nach dem Loeschen eines manuellen Teils, nach einem Wechsel des
 *     Kontofilters und beim Betreten des Reiters ebenso.
 *
 * Dieselbe Form wie beim zweiten Galerie-Lader (GalerieLaedtGefiltertTest):
 * Ein Weg fuehrt den Filter mit, ein zweiter nicht. Solange der Filter ein
 * Parameter ist, kann es diesen zweiten Weg immer wieder geben — als Feld im
 * Zustand kann es ihn nicht mehr geben.
 *
 * ── Warum nur diese drei Namen ──────────────────────────────────────────────
 * `search`, `theme`, `sort` sind die Filter, die eine LISTE einschraenken und
 * neben denen eine Gesamtzahl steht. Genau daraus entsteht der Schaden:
 * geblaetterte Seiten und eine Gesamtzahl aus verschiedenen Abfragen.
 * `loadPortfolioHistory(period)` ist bewusst nicht gemeint — der Verlauf wird
 * vollstaendig ersetzt, blaettert nicht und fuehrt keine Gesamtzahl.
 *
 * Geprueft werden ALLE Lader unter ui/, nicht nur die des MainViewModel:
 * CatalogViewModel blaettert genauso (ensureCatalogPage) und haelt seine
 * Filter ebenfalls im Zustand. Waere die Regel auf MainViewModel begrenzt,
 * duerfte ausgerechnet der zweite blaetternde Bildschirm sie brechen.
 */
class ListenfilterImZustandTest {

    @Test
    fun `kein Lader nimmt einen Listenfilter als Parameter`() {
        val filter = listOf("search", "theme", "sort")
        val verstoesse = mutableListOf<String>()
        var lader = 0

        for (datei in Quellen.unter("ui")) {
            val src = Quellen.ohneKommentare(datei.readText())
            for (treffer in Regex("""fun (?:MainViewModel\.)?(load\w+)\(([^)]*)\)""").findAll(src)) {
                lader++
                val name = treffer.groupValues[1]
                val parameter = treffer.groupValues[2]
                // Nur der PARAMETERNAME zaehlt, nicht ein Vorgabewert: Sonst
                // meldete `sort: String = "sort_name"` sich selbst.
                val namen = parameter.split(",").mapNotNull {
                    it.substringBefore(':').trim().takeIf { n -> n.isNotEmpty() }
                }
                val schuldig = namen.filter { it in filter }
                if (schuldig.isNotEmpty()) {
                    verstoesse += "${datei.name}: $name nimmt ${schuldig.joinToString()} als Parameter"
                }
            }
        }

        // Selbstbeweis: Findet das Muster keine Lader, waere die Liste leer und
        // der Test gruen, ohne etwas geprueft zu haben.
        assert(lader >= 20) {
            "Nur $lader Lader gefunden — das Muster 'fun loadXyz(' passt nicht mehr."
        }

        assert(verstoesse.isEmpty()) {
            "Diese Lader nehmen einen Listenfilter als Argument:\n  " +
                verstoesse.joinToString("\n  ") +
                "\nDann kennt ihn nur, wer ihn mitgibt — jeder andere Ladeweg laedt " +
                "ungefiltert und haengt das Ergebnis an eine gefilterte Liste. " +
                "Der Filter gehoert in den UiState der Liste; der Lader liest ihn dort."
        }
    }

    @Test
    fun `jeder Abruf der Teileliste fuehrt Blickfeld und Suchtext mit`() {
        val aufruf = "repo.teile.getParts("
        // theme und sort kennt die Teile-API nicht (utils/handlers/parts.ts,
        // getParts liest color, category, search, spare, set_number, page).
        val pflicht = listOf("accounts", "search")
        val fehlend = mutableListOf<String>()
        var gefunden = 0

        for (datei in Quellen.alle()) {
            val src = Quellen.ohneKommentare(datei.readText())
            var i = src.indexOf(aufruf)
            while (i >= 0) {
                gefunden++
                var tiefe = 1
                var j = i + aufruf.length
                while (j < src.length && tiefe > 0) {
                    val c = src[j]
                    if (c == '(') {
                        tiefe++
                    } else if (c == ')') {
                        tiefe--
                    }
                    j++
                }
                val text = src.substring(i, j)
                val fehlt = pflicht.filterNot { text.contains(it) }
                if (fehlt.isNotEmpty()) {
                    val zeile = src.substring(0, i).count { it == '\n' } + 1
                    fehlend += "${datei.name}:$zeile — es fehlt: ${fehlt.joinToString()}"
                }
                i = src.indexOf(aufruf, j)
            }
        }

        assert(gefunden >= 1) { "Kein Aufruf von '$aufruf' gefunden — Muster veraltet?" }
        assert(fehlend.isEmpty()) {
            "Diese Abrufe der Teileliste lassen etwas weg:\n  " + fehlend.joinToString("\n  ")
        }
    }
}
