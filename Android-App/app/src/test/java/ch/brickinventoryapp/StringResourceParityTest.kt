package ch.brickinventoryapp

import org.junit.Test

/**
 * Jeder Text steht in BEIDEN Sprachen, und kein Text steht im Quelltext.
 *
 * ── Woher dieser Test kommt (Nachtrag 115) ──────────────────────────────────
 *
 * Zwei Lücken, die niemand sieht, weil beide nur die jeweils andere Sprache
 * treffen:
 *
 *  1. Vier Schlüssel gab es nur in `values/strings.xml`:
 *     `settings_default_condition`, `_hint`, `_global` und
 *     `monitoring_default_condition`. Ein deutscher Nutzer las in den
 *     Einstellungen „Default condition" und „— Global default —". Android
 *     fällt bei einem fehlenden Eintrag stillschweigend auf die
 *     Vorgabesprache zurück — es gibt keinen Fehler, nur einen englischen
 *     Satz mitten in einer deutschen Oberfläche.
 *
 *  2. `PdfViewerScreen.kt` benutzte kein einziges `stringResource`.
 *     Beschriftungen, Ladetexte und drei Toasts standen als deutsche Literale
 *     im Code — für einen englischsprachigen Nutzer der einzige Bildschirm,
 *     der die Sprache wechselt, samt unübersetzter Beschriftungen für den
 *     Bildschirmleser.
 *
 * Durchgerutscht sind beide, weil die vorhandenen Prüfungen (ServicePolishTest,
 * IconButtonLabelTest) je eine LISTE von Schlüsseln abhaken. Was nicht auf der
 * Liste steht, prüft niemand. Dieser Test hakt keine Liste ab, sondern
 * vergleicht die Dateien vollständig.
 */
class StringResourceParityTest {

    // Als Konstanten, damit der Dollar nicht in einer Zeichenketten-Vorlage
    // steht — in Kotlin müsste er dort umständlich maskiert werden, und genau
    // solche Maskierungen haben in dieser Reihe schon zweimal einen Test
    // stillschweigend etwas anderes prüfen lassen als beabsichtigt.
    private val DOLLAR = '\u0024'
    private val AUSDRUCK_AUF = "$DOLLAR{"
    private val AUSDRUCK_LANG = "\\$DOLLAR\\{[^}]*\\}"
    private val AUSDRUCK_KURZ = "\\$DOLLAR\\w+"

    private fun schluessel(datei: String): Set<String> =
        Regex("""<string name="([^"]+)"""")
            .findAll(java.io.File("src/main/res/$datei").readText())
            .map { it.groupValues[1] }.toSet()

    @Test
    fun `jeder Text steht in beiden Sprachdateien`() {
        val en = schluessel("values/strings.xml")
        val de = schluessel("values-de/strings.xml")
        assert(en.size > 300) { "Zu wenige Texte gefunden (${en.size}) — Muster veraltet?" }

        val nurEn = (en - de).sorted()
        val nurDe = (de - en).sorted()
        assert(nurEn.isEmpty()) {
            "Nur in values/, fehlt auf Deutsch (Android zeigt dort still Englisch):\n  " +
                nurEn.joinToString("\n  ")
        }
        // Die Gegenrichtung ist harmloser, aber ebenso ein Fehler: ein
        // deutscher Eintrag ohne englisches Gegenstück ist toter Ballast,
        // denn values/ ist die Vorgabesprache und wird immer gelesen.
        assert(nurDe.isEmpty()) {
            "Nur in values-de/, ohne Gegenstück in values/:\n  " + nurDe.joinToString("\n  ")
        }
    }

    @Test
    fun `kein Klartext in Text, contentDescription oder Toast`() {
        // Was gesucht wird, ist ein LITERAL an einer Stelle, die der Nutzer
        // liest. Bewusst NICHT beanstandet:
        //  - Emoji und Symbole ("👷", "📅") — die sind in jeder Sprache gleich
        //    und stehen absichtlich im Code statt in den Sprachdateien.
        //  - Zeichenketten mit Platzhaltern, die nur Zahlen zusammensetzen
        //    ("${'$'}{a} / ${'$'}{b}").
        //  - Alles ausserhalb der drei genannten Stellen; ein Dateiname oder
        //    ein MIME-Typ ist kein Oberflächentext.
        val muster = listOf(
            Regex("""Text\(\s*"([^"]{3,})"""),
            Regex("""contentDescription\s*=\s*"([^"]{3,})""""),
            Regex("""Toast\.makeText\([^,]+,\s*"([^"]{3,})"""),
        )
        // Eigennamen und Abkürzungen, die in jeder Sprache gleich lauten.
        // Kurz halten: Jeder Eintrag hier ist eine Ausnahme, die niemand mehr
        // prüft.
        val erlaubt = setOf("BrickInventory", "Manager", "BrickInventory Manager", "PDF")

        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            for (m in muster) {
                m.findAll(s).forEach { treffer ->
                    val text = treffer.groupValues[1]
                    if (text in erlaubt) return@forEach
                    // Eine offene Klammer ohne schliessende heisst: Der
                    // Ausdruck enthält selbst eine Zeichenkette, und der
                    // Treffer bricht an deren Anführungszeichen ab. So ein
                    // Bruchstück ist nicht beurteilbar — hier wird nicht
                    // geraten, sondern übergangen. Ein echter Parser wäre die
                    // Alternative; für diese Handvoll Fälle lohnt er nicht.
                    if (text.contains(AUSDRUCK_AUF) && !text.contains("}")) return@forEach
                    // Ausdrücke entfernen, DANN auf Sprache prüfen: Ohne das
                    // zählte der Variablenname in einer Einsetzung als Text und
                    // meldete zwanzig Fehlalarme.
                    val nurText = text
                        .replace(Regex(AUSDRUCK_LANG), "")
                        .replace(Regex(AUSDRUCK_KURZ), "")
                    // Mindestens zwei aufeinanderfolgende Buchstaben — das
                    // trennt Sprache von Symbolen und Zahlenformaten.
                    if (!Regex("""\p{L}\p{L}""").containsMatchIn(nurText)) return@forEach
                    val zeile = s.substring(0, treffer.range.first).count { it == '\n' } + 1
                    fehler += "${datei.name}:$zeile  \"$text\""
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Oberflächentext als Literal statt aus den Sprachdateien:\n  " +
                fehler.joinToString("\n  ")
        }
    }
}
