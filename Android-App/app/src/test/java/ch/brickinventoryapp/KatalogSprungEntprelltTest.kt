package ch.brickinventoryapp

import ch.brickinventoryapp.ui.CatalogYearMath
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import org.junit.Test

/**
 * Ein Zug an der Jahresleiste holt EINE Seite, nicht hundert.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * Zuerst: „wenn ich im Katalog zu einem Jahr springe dauert es einige Sekunden
 * bis die Bilder angezeigt werden. wenn ich sonst scrolle kommen sie fluessig."
 *
 * Nach meiner ersten Behebung UNVERAENDERT: „In der Android-App dauert es im
 * Katalog noch immer 3-5 Sek." Dazu drei Beobachtungen, die zusammen die
 * Ursache festnageln:
 *   • Der Bereich ist in dieser Zeit GANZ LEER — es fehlen die Seitendaten,
 *     nicht die Bilder.
 *   • Beim ZWEITEN Besuch desselben Jahres dauert es genauso lange — also
 *     kein Cache-Problem.
 *   • In der Webapp geht dasselbe sofort — also kein Server-Problem.
 *
 * ── Was gemessen wurde, bevor etwas geaendert wurde ─────────────────────────
 * Zuerst war die Datenbank verdaechtig — ein `ORDER BY year DESC … LIMIT 60
 * OFFSET <gross>` wird bei grossen Spruengen teuer. An 25'000 Sets mit
 * realistischer Jahresverteilung nachgemessen: Seite 1 braucht 1,0 ms, die
 * Mitte 9,2 ms, das Ende 19,9 ms, der COUNT(*) je Seite 1,8 ms. Selbst der
 * schlechteste Fall bleibt weit unter einer Sekunde. Die Sekunden kommen NICHT
 * von dort — und Marcos „in der Webapp sofort" bestaetigt das unabhaengig.
 *
 * ── Die Ursache, und mein eigener Fehlgriff dabei ───────────────────────────
 * Es gibt ZWEI Wege, auf denen eine Seite angefordert wird:
 *
 *   1. der Rueckruf der Leiste (`onScrollTo`) — er laeuft bei jedem
 *      Beruehrungspunkt;
 *   2. der Sichtfenster-Lader — er laeuft, wann immer sich das sichtbare
 *      Fenster aendert.
 *
 * Mein erster Anlauf entprellte NUR Weg 1 und schrieb fuer Weg 2 sogar
 * ausdruecklich fest, er habe „weiterhin unmittelbar" zu laden. Das war
 * falsch, und zwar aus einem Denkfehler: Die Leiste ROLLT die Liste wirklich
 * an jede Zwischenposition (ihr Rueckruf setzt ueber `state.scrollTo` ein
 * `gridState.scrollToItem`). Weg 2 sah damit jeden einzelnen Punkt des Zuges
 * und forderte dort weiter drei Seiten an. Die Zahl der Abrufe blieb, wie sie
 * war — deshalb aenderte sich fuer Marco nichts.
 *
 * Die Ruhe steht jetzt im Sichtfenster-Lader. Sie deckt beide Wege ab, denn
 * beide enden dort. Genau so macht es die Webapp seit jeher
 * (js/09-catalog.js, `_ladeSichtbareSeiten`, 150 ms) — und genau deshalb ist
 * die Webapp schnell.
 *
 * ── Warum die Pruefungen am Quelltext haengen ───────────────────────────────
 * Ein Compose-Effekt laesst sich ohne Android-Laufzeit nicht ausfuehren. Die
 * REIHENFOLGE („warten, dann laden") und die STELLE dagegen sind Tatsachen der
 * Datei. Das Verhalten selbst ist auf der Webapp-Seite gemessen, wo derselbe
 * Mechanismus in jsdom laufen kann: katalog-zug-entprellt.test.js, 2 Abrufe
 * mit Ruhe gegen 48 ohne.
 */
class KatalogSprungEntprelltTest {

    @Test
    fun `ein Zug ueber die Leiste beruehrt sehr viele Seiten`() {
        // Ein gewoehnliches Telefon: Leiste ueber die volle Hoehe, Griff 36dp
        // bei dreifacher Dichte. Der Katalog hat rund 25'000 Sets.
        val hoehe = 1800
        val griff = 108
        val total = 25_000

        // Jeder Pixel, den der Finger auf dem Weg von oben nach unten
        // ueberstreicht — genau die Punkte, an denen die Liste weitergerollt
        // wird und der Sichtfenster-Lader ein neues Fenster sieht.
        val seiten = (0..hoehe).map { y ->
            val anteil = CatalogYearMath.anteilAus(y.toFloat(), hoehe, griff)
            CatalogYearMath.nummerAus(anteil, total) / CATALOG_PAGE_SIZE + 1
        }.toSet()

        // GEMESSEN, nicht behauptet: Der Weg beruehrt JEDE Seite des Katalogs
        // — 417 von 417. Auf 1692 Pixeln Spur liegen 25'000 Sets, also rund
        // 15 je Pixel; eine Seitengrenze wird demnach alle vier Pixel
        // ueberschritten.
        //
        // Wie viele Abrufe daraus WERDEN, entscheidet die Zahl der
        // Beruehrungspunkte: Zwei aufeinanderfolgende liegen bei jeder
        // gewoehnlichen Zuggeschwindigkeit weiter als vier Pixel auseinander,
        // also trifft praktisch jeder eine andere Seite. Bei 60 bis 120
        // Punkten je Sekunde sind das ueber hundert Abrufe fuer einen Zug —
        // jeder ueber 60 Sets, keiner abgebrochen, und der API-Client laesst
        // nur eine Handvoll gleichzeitig zu. Die Zielseite steht dann hinter
        // allen anderen in der Schlange. Das sind Marcos 3 bis 5 Sekunden.
        val gesamtSeiten = (total - 1) / CATALOG_PAGE_SIZE + 1
        assert(seiten.size >= gesamtSeiten - 1) {
            "Der Weg beruehrt nur ${seiten.size} von $gesamtSeiten Seiten. Dann " +
                "waere die Entprellung die falsche Behebung, und die Ursache laege " +
                "woanders — nachrechnen, bevor hier eine Zahl angepasst wird."
        }
        assert(gesamtSeiten > 100) { "Katalog zu klein fuer diese Aussage — Rechnung veraltet?" }
    }

    @Test
    fun `der Sichtfenster-Lader wartet, bis die Liste ruhig steht`() {
        // ── Diese Pruefung stand einmal genau ANDERSHERUM ────────────────────
        // Sie hiess „das Sichtfenster laedt weiterhin unmittelbar" und verlangte
        // den Abruf ohne jede Wartezeit — mit der Begruendung, beim
        // gewoehnlichen Scrollen sei nie etwas falsch gewesen. Das stimmt, ist
        // aber nicht der ganze Fall: Beim Ziehen an der Leiste laeuft derselbe
        // Lader, nur hundertfach. Die Regel schrieb damit die Ursache fest.
        //
        // Sie steht hier bewusst als umgedrehte Fassung und nicht als neue
        // Datei: Wer sie kuenftig wieder „auf sofort" stellen will, soll den
        // Grund lesen, warum das schon einmal falsch war.
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/CatalogScreen.kt"))

        val ab = src.indexOf("snapshotFlow {")
        assert(ab > 0) { "Der Sichtfenster-Lader ist nicht mehr zu finden" }
        val lader = src.substring(ab, minOf(ab + 900, src.length))

        // `collectLatest`, nicht `collect`: Nur damit bricht ein neues
        // Sichtfenster den wartenden Durchlauf ab. Mit `collect` wuerde jeder
        // Punkt des Zuges bloss VERZOEGERT geladen — dieselbe Zahl Abrufe, nur
        // spaeter. Das ist der Unterschied zwischen entprellen und aufschieben.
        assert(lader.contains(".collectLatest {")) {
            "Der Sichtfenster-Lader sammelt wieder mit `collect`. Dann wird jeder " +
                "Punkt eines Zuges nur aufgeschoben statt verworfen, und es bleibt " +
                "bei ueber hundert Abrufen je Zug."
        }
        // Und die Reihenfolge: erst warten, dann laden.
        val warten = lader.indexOf("delay(")
        val laden = lader.indexOf("onEnsurePage")
        assert(warten > 0 && laden > 0) { "Warten oder Laden fehlt im Sichtfenster-Lader" }
        assert(warten < laden) {
            "Es wird geladen, bevor gewartet wird — dann entprellt nichts"
        }
        // Vorlauf in beide Richtungen bleibt: nach einem Sprung fehlte sonst
        // alles oberhalb der Sprungstelle.
        assert(lader.contains("(von - 1)..(bis + 1)")) {
            "Der Vorlauf in beide Richtungen ist verschwunden"
        }
    }

    @Test
    fun `die Leiste rollt nur und laedt nicht selbst`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/CatalogScreen.kt"))

        val ab = src.indexOf("onScrollTo = ")
        assert(ab > 0) { "Der Rueckruf der Jahresleiste ist nicht mehr zu finden" }
        val rueckruf = src.substring(ab, minOf(ab + 200, src.length))
        assert(!rueckruf.contains("onEnsurePage")) {
            "Die Leiste laedt wieder bei JEDEM Beruehrungspunkt. Das sind ueber " +
                "hundert Abrufe je Zug (siehe die Messung im ersten Test)."
        }

        // Und kein zweiter, eigener Sprung-Abruf daneben: Der stand hier
        // einmal (`zielSeite` samt eigenem LaunchedEffect) und war die
        // Behebung an der falschen Schicht — er nahm dem Rueckruf seinen
        // Abruf, liess den Sichtfenster-Lader aber unveraendert weiterlaufen.
        // Zwei Fassungen derselben Regel laufen ausserdem auseinander.
        assert(!src.contains("zielSeite")) {
            "Der eigene Sprung-Abruf ist wieder da. Er ist ueberfluessig, seit die " +
                "Ruhe im Sichtfenster-Lader steht — dort enden BEIDE Wege."
        }
    }
}
