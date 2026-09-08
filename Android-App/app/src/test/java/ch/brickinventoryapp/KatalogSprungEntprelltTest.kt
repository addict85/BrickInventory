package ch.brickinventoryapp

import ch.brickinventoryapp.ui.CatalogYearMath
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import org.junit.Test

/**
 * Ein Zug an der Jahresleiste holt EINE Seite, nicht hundert.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „wenn ich im Katalog zu einem Jahr springe dauert es einige Sekunden bis die
 * Bilder angezeigt werden. wenn ich sonst scrolle kommen sie fluessig."
 *
 * ── Was gemessen wurde, bevor etwas geaendert wurde ─────────────────────────
 * Zuerst war die Datenbank verdaechtig — ein `ORDER BY year DESC … LIMIT 60
 * OFFSET <gross>` wird bei grossen Spruengen teuer. An 25'000 Sets mit
 * realistischer Jahresverteilung nachgemessen: Seite 1 braucht 1,0 ms, die
 * Mitte 9,2 ms, das Ende 19,9 ms, der COUNT(*) je Seite 1,8 ms. Selbst der
 * schlechteste Fall bleibt weit unter einer Sekunde. Die Sekunden kommen NICHT
 * von dort.
 *
 * Sie kamen von der Leiste selbst: `rollen()` laeuft bei jedem
 * Beruehrungspunkt, und dort stand ein `onEnsurePage(...)`. Wie viele Seiten
 * das sind, rechnet die erste Pruefung hier aus — mit derselben Mathematik,
 * die die Leiste benutzt. Es ist keine Schaetzung.
 *
 * ── Warum die zweite Pruefung am Quelltext haengt ───────────────────────────
 * Die Behebung ist ein `LaunchedEffect` auf die Zielseite: Aendert sich der
 * Wert, bricht der vorige Durchlauf ab, und erst wenn der Finger zur Ruhe
 * kommt, wird geladen. Ein Compose-Effekt laesst sich ohne Android-Laufzeit
 * nicht ausfuehren — die REIHENFOLGE („merken, nicht laden") dagegen ist eine
 * Tatsache der Datei.
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
        // ueberstreicht — genau die Punkte, an denen `rollen()` feuerte.
        val seiten = (0..hoehe).map { y ->
            val anteil = CatalogYearMath.anteilAus(y.toFloat(), hoehe, griff)
            CatalogYearMath.nummerAus(anteil, total) / CATALOG_PAGE_SIZE + 1
        }.toSet()

        // GEMESSEN, nicht behauptet: Der Weg beruehrt JEDE Seite des Katalogs
        // — 417 von 417. Auf 1692 Pixeln Spur liegen 25'000 Sets, also rund
        // 15 je Pixel; eine Seitengrenze wird demnach alle vier Pixel
        // ueberschritten.
        //
        // Wie viele Abrufe daraus WURDEN, entschied die Zahl der
        // Beruehrungspunkte: Zwei aufeinanderfolgende liegen bei jeder
        // gewoehnlichen Zuggeschwindigkeit weiter als vier Pixel auseinander,
        // also traf praktisch jeder eine andere Seite. Bei 60 bis 120 Punkten
        // je Sekunde sind das ueber hundert Abrufe fuer einen Zug — jeder
        // ueber 60 Sets, keiner abgebrochen.
        val gesamtSeiten = (total - 1) / CATALOG_PAGE_SIZE + 1
        assert(seiten.size >= gesamtSeiten - 1) {
            "Der Weg beruehrt nur ${seiten.size} von $gesamtSeiten Seiten. Dann " +
                "waere die Entprellung die falsche Behebung, und die Ursache laege " +
                "woanders — nachrechnen, bevor hier eine Zahl angepasst wird."
        }
        assert(gesamtSeiten > 100) { "Katalog zu klein fuer diese Aussage — Rechnung veraltet?" }
    }

    @Test
    fun `die Leiste merkt sich die Zielseite, statt sie zu laden`() {
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/CatalogScreen.kt"))

        // Der Rueckruf der Leiste: merken, nicht laden.
        val ab = src.indexOf("onScrollTo = { nummer ->")
        assert(ab > 0) { "Der Rueckruf der Jahresleiste ist nicht mehr zu finden" }
        val rueckruf = src.substring(ab, src.indexOf("},", ab))
        assert(rueckruf.contains("zielSeite =")) {
            "Der Rueckruf merkt sich die Zielseite nicht"
        }
        assert(!rueckruf.contains("onEnsurePage")) {
            "Die Leiste laedt wieder bei JEDEM Beruehrungspunkt. Das sind ueber " +
                "hundert Abrufe je Zug (siehe die Messung im ersten Test), und die " +
                "Seite, auf der man landet, steht dann hinter allen anderen."
        }

        // Und der entprellte Abruf steht da, mit Wartezeit VOR dem Laden.
        assert(src.contains("LaunchedEffect(zielSeite)")) {
            "Der entprellte Abruf fehlt — dann wird die Zielseite nie geholt"
        }
        val effekt = src.substring(src.indexOf("LaunchedEffect(zielSeite)"))
            .lineSequence().take(8).joinToString("\n")
        val warten = effekt.indexOf("delay(")
        val laden  = effekt.indexOf("onEnsurePage")
        assert(warten in 1 until laden) {
            "Es wird geladen, bevor gewartet wird — dann entprellt nichts"
        }
    }

    @Test
    fun `das Sichtfenster laedt weiterhin unmittelbar`() {
        // Die Entprellung gilt NUR fuer den Sprung. Beim gewoehnlichen
        // Scrollen war nie etwas falsch: eine Seite Vorlauf, sofort geholt.
        // Eine Wartezeit dort waere eine Verschlechterung, die niemand
        // verlangt hat.
        val src = Quellen.ohneKommentare(Quellen.lies("ui/screens/CatalogScreen.kt"))
        assert(src.contains("for (seite in (von - 1)..(bis + 1)) if (seite >= 1) onEnsurePage(seite)")) {
            "Der Sichtfenster-Lader wurde mit umgebaut — er soll bleiben, wie er war"
        }
    }
}
