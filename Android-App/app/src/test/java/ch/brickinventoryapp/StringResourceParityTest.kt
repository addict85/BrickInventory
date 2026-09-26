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

    /**
     * Gleicher Text in beiden Dateien heisst: nicht uebersetzt.
     *
     * ── Warum der Test oben das nicht faengt (Nachtrag 136) ─────────────────
     *
     * `jeder Text steht in beiden Sprachdateien` vergleicht NAMEN. Die zehn
     * Texte der Preisalarm-Rubrik standen brav in beiden Dateien — nur trug
     * die deutsche denselben englischen Satz. Marco las in den Einstellungen
     * seiner deutschen App „rises above" und „○ has fired" und musste
     * nachfragen, was die Rubrik ihm eigentlich sagt.
     *
     * Der Fehler ist nicht das Vergessen, sondern seine Form: Wer einen neuen
     * Text anlegt, kopiert den Block in die zweite Datei — und uebersetzt ihn
     * dann nicht. Beide Dateien sehen danach vollstaendig aus. Kein Schalter
     * steht auf Rot, keine Zeile fehlt. Deshalb prueft dieser Test nicht
     * Vollstaendigkeit, sondern Verschiedenheit.
     *
     * ── Warum eine Liste und keine Heuristik ────────────────────────────────
     *
     * NACHGEMESSEN standen nach der Uebersetzung noch 30 Eintraege in beiden
     * Dateien gleich, und alle 30 zu Recht: „Sets", „Scan", „OK", „Details",
     * Formatvorlagen wie `×%1${DOLLAR}d`, die Adresse im Platzhalter. Eine
     * Heuristik („mindestens zwei richtige Woerter") haette acht der zehn
     * Alarm-Texte gefunden und dafuer `app_name` und `monitoring_title`
     * faelschlich gemeldet — also beides falsch: unvollstaendig UND laut.
     *
     * Die Liste ist stattdessen eine Behauptung, die jeder Eintrag einzeln
     * traegt: „dieser Text lautet in beiden Sprachen gleich, und das ist
     * gewollt". Neue Texte kommen nicht von selbst hinein — genau das ist der
     * Zweck. Und wie bei `erlaubt` weiter unten prueft der Test die Liste
     * selbst mit: Ein Eintrag, der nicht mehr zutrifft, fliegt raus, statt als
     * alte Entscheidung stehenzubleiben, die niemand mehr nachsieht.
     */
    @Test
    fun `kein Text steht in beiden Sprachen unuebersetzt`() {
        // Begriffe, Eigennamen und Formatvorlagen, die in beiden Sprachen
        // gleich lauten. Jeder Eintrag ist eine Entscheidung, keine Nachsicht.
        val gewolltGleich = setOf(
            "acq_total_quantity", "app_name", "catalog_sort_name", "chart_period_max",
            "comparison_barcode_label", "comparison_scan", "csv_ok_count",
            "csv_upload_sets", "detail_section_item", "finance_filter_sets",
            "finance_grand_total", "finance_section_sets", "finance_total_sets",
            "gallery_quantity_badge", "gallery_sort_name", "gallery_stat_sets",
            "main_menu_monitoring", "monitoring_cache_subsets", "monitoring_theme",
            "monitoring_theme_noppe", "monitoring_title", "monitoring_vorwaermen_roaming",
            "nav_minifigs_short", "nav_monitoring", "partslist_ok", "partslist_rb_prefix",
            "partslist_scan", "settings_current_summary", "setup_build",
            "setup_url_placeholder",
        )

        val en = texte("values/strings.xml")
        val de = texte("values-de/strings.xml")
        assert(en.size > 300) { "Zu wenige Texte gefunden (${en.size}) — Muster veraltet?" }

        val gleich = en.keys.filter { it in de && en[it] == de[it] }.toSet()
        val unuebersetzt = (gleich - gewolltGleich).sorted()
        assert(unuebersetzt.isEmpty()) {
            "Diese Texte stehen auf Deutsch wortgleich wie auf Englisch — sehr " +
                "wahrscheinlich beim Anlegen kopiert und nicht uebersetzt:\n  " +
                unuebersetzt.joinToString("\n  ") { "$it = \"${en[it]}\"" } +
                "\nIst er wirklich in beiden Sprachen gleich, gehoert er in `gewolltGleich`."
        }
        val veraltet = (gewolltGleich - gleich).sorted()
        assert(veraltet.isEmpty()) {
            "Diese Eintraege in `gewolltGleich` stimmen nicht mehr (Text unterscheidet " +
                "sich inzwischen oder Name ist weg): " + veraltet.joinToString(", ") + " — raus damit."
        }
    }

    /**
     * Name → Text. Anders als [schluessel] verlangt das Muster hier ein `">`
     * direkt hinter dem Namen und überspringt damit den einen Eintrag mit
     * Zusatz (`lang_code translatable="false"`). Das ist richtig so: Der
     * Sprachcode ist kein Oberflächentext, und für den Vergleich unten wäre er
     * nur Rauschen.
     */
    private fun texte(datei: String): Map<String, String> =
        Regex("""<string name="([^"]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(java.io.File("src/main/res/$datei").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }

    /**
     * Was einen `common_`-Namen hat, steht nicht noch einmal unter einem zweiten.
     *
     * ── Warum das keine erfundene Regel ist ─────────────────────────────────
     *
     * Die `common_`-Namen gibt es bereits — `common_delete`, `common_cancel`,
     * `common_quantity`, `common_back`, `common_condition`. Wer sie angelegt
     * hat, hat die Entscheidung „das ist EIN Text" schon getroffen. Nur
     * durchgezogen wurde sie nicht: NACHGEMESSEN standen sechzehn weitere
     * Namen mit demselben Wort in BEIDEN Sprachen daneben — fünfmal „Löschen",
     * fünfmal „Abbrechen", viermal „Anzahl", zweimal „Zurück".
     *
     * Was das kostet, ist nicht der Platz, sondern das Auseinanderlaufen: Wer
     * „Anzahl" in „Menge" ändert, ändert es an einer Stelle, und danach heisst
     * dasselbe Feld im Teile-Reiter anders als im Figuren-Reiter. Genau das
     * soll bei zwei Oberflächen, die gleich aussehen sollen, nicht passieren.
     *
     * Bewusst NUR gegen `common_`: „Zwei Namen mit gleichem Wert" allein wäre
     * zu grob — `login_title` und `login_button` heissen beide „Anmelden" und
     * dürfen sich unabhängig ändern. Der `common_`-Name ist das Zeichen, dass
     * jemand die Gemeinsamkeit ausdrücklich gewollt hat.
     */
    @Test
    fun `kein zweiter Name fuer einen common-Text`() {
        val en = texte("values/strings.xml")
        val de = texte("values-de/strings.xml")
        assert(en.size > 300) { "Zu wenige Texte gefunden (${en.size}) — Muster veraltet?" }
        val gemeinsam = en.keys.filter { it.startsWith("common_") }
        assert(gemeinsam.size >= 3) { "Nur ${gemeinsam.size} common_-Namen — Konvention aufgegeben?" }

        val doppelt = mutableListOf<String>()
        for (g in gemeinsam.sorted()) {
            for (k in en.keys.sorted()) {
                if (k == g || k.startsWith("common_")) continue
                // In BEIDEN Sprachen gleich. Nur Englisch zu vergleichen
                // fände zufällige Gleichklänge („Sets"/„Sets"), die auf
                // Deutsch verschieden sind.
                if (en[k] == en[g] && de[k] == de[g]) doppelt += "$k = $g (\"${en[g]}\")"
            }
        }
        assert(doppelt.isEmpty()) {
            "Diese Namen tragen denselben Text wie ein common_-Name; nimm den common_-Namen:\n  " +
                doppelt.joinToString("\n  ")
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
        // Kurz halten: Jeder Eintrag hier ist eine Ausnahme — und damit sie
        // nicht, wie es hier stand, „niemand mehr prüft", tut es jetzt der
        // Test selbst: Am Ende muss jeder Eintrag mindestens einmal gegriffen
        // haben. Ein Eintrag, der nichts mehr beschreibt, sieht aus wie eine
        // Entscheidung und ist doch bloss eine Vermutung.
        val erlaubt = setOf("BrickInventory", "Manager", "BrickInventory Manager", "PDF")
        val erlaubtGesehen = mutableSetOf<String>()

        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            for (m in muster) {
                m.findAll(s).forEach { treffer ->
                    val text = treffer.groupValues[1]
                    if (text in erlaubt) { erlaubtGesehen += text; return@forEach }
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
        val veraltet = (erlaubt - erlaubtGesehen).sorted()
        assert(veraltet.isEmpty()) {
            "Diese Eintraege in `erlaubt` beschreiben nichts mehr: " +
                veraltet.joinToString(", ") +
                " — der Text steht nirgends mehr im Quelltext. Raus damit."
        }
    }
}
