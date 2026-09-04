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

    /**
     * Gesucht wird auf dem Server, nicht im Bildschirm.
     *
     * ── Der Befund ──────────────────────────────────────────────────────────
     * MinifigsScreen hielt seinen Suchtext lokal und filterte die schon
     * geladene Liste selbst:
     *
     *     figs.filter { it.figNumber.contains(search, ignoreCase = true) ||
     *                   it.figName?.contains(search, ignoreCase = true) == true }
     *
     * Damit stand dieselbe Suchregel zweimal im Baum — einmal hier, einmal in
     * utils/handlers/minifigs.ts. Und sie waren nicht deckungsgleich: Der
     * Server sucht VOR der Gruppierung ueber jede fig_name-Zeile, der
     * Bildschirm danach nur ueber die eine, die MAX(fig_name) uebrig laesst.
     * Dieselbe Figur, die in zwei Sets unter zwei Namen steht, fand die Webapp
     * und das Telefon nicht.
     *
     * ── Was geprueft wird ───────────────────────────────────────────────────
     * Ein `.filter { … contains(…, ignoreCase = true) … }` unter ui/ ist die
     * Form einer Suche im Bildschirm. Erlaubt bleibt sie, wo die Liste
     * VOLLSTAENDIG im Speicher liegt und nicht blaettert — dort waere ein
     * Serverbesuch nur langsamer. Diese Stellen stehen unten mit Grund.
     */
    @Test
    fun `keine Suche im Bildschirm ueber eine geladene Liste`() {
        // Vollstaendig geladene, kurze Listen ohne Blaettern und ohne
        // Gesamtzahl daneben — hier ist oertliches Filtern richtig.
        val erlaubt = mapOf(
            "CatalogSections.kt" to
                "Themenliste des Katalogs: einmal komplett geladen (state.themes), " +
                "keine Seiten, keine Gesamtzahl. Ein Serverbesuch je Tastendruck " +
                "waere nur langsamer."
        )

        val muster = Regex("""\.filter\s*\{[^}]*contains\([^)]*ignoreCase\s*=\s*true""")
        val gefunden = mutableListOf<Pair<String, Int>>()

        for (datei in Quellen.unter("ui")) {
            val src = Quellen.ohneKommentare(datei.readText())
            for (treffer in muster.findAll(src)) {
                val zeile = src.substring(0, treffer.range.first).count { it == '\n' } + 1
                gefunden += datei.name to zeile
            }
        }

        // Selbstbeweis: Findet das Muster gar nichts, waere die Liste leer und
        // der Test gruen, ohne etwas geprueft zu haben. Erwartet wird
        // mindestens die eine begruendete Stelle.
        assert(gefunden.isNotEmpty()) {
            "Kein einziges oertliches Filtern gefunden — das Muster passt nicht mehr."
        }

        val verstoesse = gefunden.filterNot { it.first in erlaubt }
        assert(verstoesse.isEmpty()) {
            "Hier wird im Bildschirm ueber eine geladene Liste gesucht:\n  " +
                verstoesse.joinToString("\n  ") { "${it.first}:${it.second}" } +
                "\nDann steht die Suchregel zweimal — hier und im Server-Handler — " +
                "und beide treffen frueher oder spaeter etwas anderes. Der Suchtext " +
                "gehoert in den UiState, der Lader gibt ihn dem Server mit. Ist die " +
                "Liste vollstaendig geladen und blaettert nicht, gehoert sie mit " +
                "Grund in die Liste `erlaubt` oben."
        }

        // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
        // prueft — dieselbe Regel wie in den Waechtern der Webapp.
        val veraltet = erlaubt.keys.filterNot { name -> gefunden.any { it.first == name } }
        assert(veraltet.isEmpty()) {
            "Diese Eintraege beschreiben kein oertliches Filtern mehr — streichen:\n  " +
                veraltet.joinToString("\n  ")
        }
    }
}
