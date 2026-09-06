package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Jeder eingehaengte Bildschirm muss auch erreichbar sein.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Marcos Frage: „wo finde ich die Einstellungen in der Android-App?" Die
 * Antwort war: nirgends. `Screen.Settings` stand seit dem ersten Commit im
 * Navigationsgraphen (nav/ToolsGraph.kt) und kam im ganzen Hauptbaum GENAU
 * EINMAL vor — in seiner eigenen Registrierung. Kein Reiter, kein Menuepunkt,
 * kein Deep-Link.
 *
 * Unerreichbar waren damit Waehrung, Standard-Zustand, Preis-Zustand, Sprache,
 * Haushalt, Konto, CSV-Import, angemeldete Geraete und die Update-Pruefung —
 * alles gebaut, alles uebersetzt, nichts davon zu sehen.
 *
 * Der Uebersetzer kann das nicht melden: Ein registrierter Bildschirm ohne
 * Aufrufer ist gueltiges Kotlin. Auffallen kann es nur hier oder beim
 * Benutzen.
 *
 * ── Warum die Regel ZWEI Wege kennen muss ───────────────────────────────────
 *
 * NACHGEMESSEN: Die naheliegende Fassung — „zu jedem `composable(Screen.X)`
 * muss es ein `navigate(Screen.X)` geben" — meldet SECHS Bildschirme, die
 * voellig in Ordnung sind:
 *
 *     Catalog, Comparison, Finance, Minifigs, Parts, PartsList
 *
 * Sie sind die Reiter der unteren Leiste, und dorthin navigiert
 * MainScaffold ueber die LISTE (`bottomNavItems.forEach { (screen, …) }`),
 * nicht ueber einen ausgeschriebenen Namen. Ein Test, der sechs gesunde
 * Bildschirme anmeckert und einen kranken, wird abgeschaltet statt befolgt —
 * dieselbe Erfahrung wie bei der Schichtregel im Manager: Eine Regel, die
 * Gesundes als Verstoss fuehrt, ist schlimmer als keine.
 *
 * Deshalb zaehlt hier BEIDES als Weg: ein ausgeschriebenes
 * `navigate(Screen.X.route)` oder ein Platz in der unteren Leiste
 * (`Triple(Screen.X, …)`). Mit dieser Fassung bleibt genau ein Befund uebrig —
 * der, um den es ging. Gegengeprobt am Stand vor der Behebung: `[Settings]`.
 */
class ErreichbareRoutenTest {

    private val quelle: String by lazy {
        Quellen.alle().joinToString("\n") { Quellen.ohneKommentare(it.readText()) }
    }

    private fun namen(muster: Regex): Set<String> =
        muster.findAll(quelle).map { it.groupValues[1] }.toSet()

    @Test
    fun `jeder registrierte Bildschirm hat einen Weg dorthin`() {
        val registriert = namen(Regex("""composable\(\s*Screen\.(\w+)\.route"""))
        val angesteuert = namen(Regex("""navigate\(\s*Screen\.(\w+)\.route"""))
        val inDerLeiste  = namen(Regex("""Triple\(\s*Screen\.(\w+)\s*,"""))

        // ── Untergrenzen, damit ein kaputtes Suchmuster nicht still gruen ist ──
        //
        // Findet die erste Suche nichts, ist die Differenz leer und der Test
        // bestaende, ohne etwas geprueft zu haben. Genau die Falle, gegen die
        // Quellen.alle() seine eigene Untergrenze hat. Die Zahlen sind
        // grosszuegig: gemessen sind es 12 registrierte und 7 Reiter.
        assertTrue(
            "Nur ${registriert.size} registrierte Bildschirme gefunden — vermutlich passt das " +
                "Suchmuster nicht mehr. Ohne Treffer waere diese Pruefung stillschweigend gruen.",
            registriert.size >= 8
        )
        assertTrue(
            "Nur ${inDerLeiste.size} Reiter in der unteren Leiste gefunden — siehe oben.",
            inDerLeiste.size >= 5
        )

        val ohneWeg = (registriert - angesteuert - inDerLeiste).sorted()
        assertTrue(
            "Diese Bildschirme sind im Navigationsgraphen eingehaengt, aber von nirgendwo " +
                "erreichbar: $ohneWeg. Entweder fehlt der Menuepunkt/Reiter dorthin, oder der " +
                "Bildschirm gehoert geloescht — ein Bildschirm, den niemand oeffnen kann, ist " +
                "kein Bildschirm, sondern toter Code mit Uebersetzungskosten.",
            ohneWeg.isEmpty()
        )
    }

    /**
     * Der Server gehoert zu den Einstellungen, nicht ins Konto-Menue.
     *
     * Marcos Entscheidung: Die Serveradresse ist eine Einstellung wie Waehrung
     * und Sprache — etwas, das man einmal setzt. Im Konto-Menue stand sie neben
     * „Abmelden", also neben einer Handlung an der laufenden Sitzung.
     *
     * Die Regel oben (jeder Bildschirm erreichbar) bliebe auch dann gruen, wenn
     * der Weg zurueck ins Menue wanderte — sie fragt nur, OB es einen Weg gibt,
     * nicht wo er anfaengt.
     */
    @Test
    fun `der Serverwechsel steht in den Einstellungen`() {
        val einstellungen = Quellen.ohneKommentare(Quellen.lies("ui/screens/SettingsScreen.kt"))
        assertTrue(
            "SettingsScreen.kt kennt onServerWechseln nicht — dann fuehrt von den Einstellungen " +
                "kein Weg zur Server-Einrichtung.",
            einstellungen.contains("onServerWechseln")
        )
        val geruest = Quellen.ohneKommentare(Quellen.lies("MainScaffold.kt"))
        assertTrue(
            "MainScaffold.kt navigiert wieder selbst zu Screen.Setup. Der Serverwechsel soll " +
                "an EINER Stelle stehen — in den Einstellungen; zwei Wege dorthin sind zwei " +
                "Stellen, die auseinanderlaufen koennen.",
            !geruest.contains("navigate(Screen.Setup.route)")
        )
    }

    /**
     * Und der Weg zu den Einstellungen im Besonderen.
     *
     * Die Regel oben ist allgemein und wuerde auch dann gruen, wenn jemand die
     * Einstellungen ueber irgendeinen anderen Bildschirm erreichbar machte. Der
     * Ort ist aber eine Entscheidung: Das Konto-Menue oben rechts ist die
     * Stelle fuer alles, was kein Bestandsreiter ist — dort steht schon die
     * Ueberwachung. Ein Umzug soll auffallen und bewusst geschehen.
     */
    @Test
    fun `die Einstellungen haengen im Konto-Menue`() {
        val geruest = Quellen.ohneKommentare(Quellen.lies("MainScaffold.kt"))
        assertTrue(
            "MainScaffold.kt navigiert nicht zu Screen.Settings — dann sind Waehrung, Sprache, " +
                "Haushalt, Konto und die Update-Pruefung wieder unerreichbar.",
            geruest.contains("navigate(Screen.Settings.route)")
        )
        assertTrue(
            "Der Menuepunkt traegt nicht R.string.nav_settings. Derselbe Text wie die " +
                "Ueberschrift des Bildschirms ist Absicht: Zwei Schluessel fuer dasselbe Wort " +
                "sind zwei Stellen, an denen Menue und Ziel auseinanderlaufen koennen.",
            geruest.contains("R.string.nav_settings")
        )
    }
}
