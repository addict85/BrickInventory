package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Jeder Text steht in BEIDEN Sprachen, und kein Text steht im Quelltext.
 */
class StringResourceParityTest {

    // Als Konstanten, damit der Dollar nicht in einer Zeichenketten-Vorlage
    // steht — in Kotlin müsste er dort umständlich maskiert werden, und genau
    // solche Maskierungen haben in dieser Reihe schon zweimal einen Test
    // stillschweigend etwas anderes prüfen lassen als beabsichtigt.
    private val DOLLAR = '\u0024'
    private val EXPRESSION_ON = "$DOLLAR{"
    private val EXPRESSION_LANG = "\\$DOLLAR\\{[^}]*\\}"
    private val EXPRESSION_SHORT = "\\$DOLLAR\\w+"

    private fun schluessel(datei: String): Set<String> =
        Regex("""<string name="([^"]+)"""")
            .findAll(File(Quellen.res, "$datei").readText())
            .map { it.groupValues[1] }.toSet()

    @Test
    fun `every text is in both language files`() {
        val en = schluessel("values/strings.xml")
        val de = schluessel("values-de/strings.xml")
        assert(en.size > 300) { "Zu wenige Texte gefunden (${en.size}) — Muster veraltet?" }

        val onlyEn = (en - de).sorted()
        val onlyDe = (de - en).sorted()
        assert(onlyEn.isEmpty()) {
            "Nur in values/, fehlt auf Deutsch (Android zeigt dort still Englisch):\n  " +
                onlyEn.joinToString("\n  ")
        }
        // Die Gegenrichtung ist harmloser, aber ebenso ein Fehler: ein
        // deutscher Eintrag ohne englisches Gegenstück ist toter Ballast,
        // denn values/ ist die Vorgabesprache und wird immer gelesen.
        assert(onlyDe.isEmpty()) {
            "Nur in values-de/, ohne Gegenstück in values/:\n  " + onlyDe.joinToString("\n  ")
        }
    }

    /** Name → Mengenklassen („one", „other", …) einer `<plurals>`. */
    private fun mengenformen(datei: String): Map<String, Set<String>> =
        Regex("""<plurals name="([^"]+)">(.*?)</plurals>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(Quellen.res, "$datei").readText())
            .associate { m ->
                m.groupValues[1] to Regex("""quantity="([^"]+)"""")
                    .findAll(m.groupValues[2]).map { it.groupValues[1] }.toSet()
            }

    /**
     * Mengenformen: beide Dateien, dieselben Klassen.
     *
     * ── Warum es diese Prüfung gibt ──────────────────────────
     *
     * Die Prüfung oben sucht `<string name=`. `<plurals>` war ihr unsichtbar —
     * solange es keine gab, war das kein Loch. Mit dem Beheben der zehn
     * PluralsCandidate-Befunde gibt es sechzehn, und damit wäre eine fehlende
     * deutsche Einzahlform genau der Fehler, den die Datei oben beschreibt:
     *
     * Geprüft wird darum dreierlei:
     *   1. Dieselben Namen in beiden Dateien.
     *   2. Dieselben Mengenklassen je Name — eine deutsche `<plurals>` ohne
     *      `one` sieht vollständig aus und ist es nicht.
     *
     * Gegenproben (durchgeführt, in derselben Logik gegen die echten Dateien
     * und vier verfälschte Fassungen):
     *   die echten Dateien              -> grün (16 Mengenformen)
     *   deutsche Einzahlform entfernt   -> ROT
     *   deutsche Mengenform ganz weg    -> ROT
     *   Mengenform nur auf Deutsch      -> ROT
     *   englische Mengenform ohne one   -> ROT
     */
    @Test
    fun `every plural form is in both language files with the same classes`() {
        val en = mengenformen("values/strings.xml")
        val de = mengenformen("values-de/strings.xml")

        // Selbstnachweis gegen die stille Null: Ohne Treffer liefe alles
        // darunter ins Leere und wäre trotzdem grün.
        assert(en.isNotEmpty()) {
            "Keine <plurals> in values/strings.xml gefunden — Muster veraltet?"
        }

        val onlyEn = (en.keys - de.keys).sorted()
        assert(onlyEn.isEmpty()) {
            "Mengenform nur in values/, fehlt auf Deutsch (Android zeigt dort still " +
                "Englisch):\n  " + onlyEn.joinToString("\n  ")
        }
        val onlyDe = (de.keys - en.keys).sorted()
        assert(onlyDe.isEmpty()) {
            "Mengenform nur in values-de/, ohne Gegenstück in values/:\n  " +
                onlyDe.joinToString("\n  ")
        }

        val otherClasses = en.keys.filter { it in de && en[it] != de[it] }.sorted()
        assert(otherClasses.isEmpty()) {
            "Diese Mengenformen haben in den beiden Dateien NICHT dieselben " +
                "Mengenklassen — die fehlende Fassung fällt still auf Englisch " +
                "zurück:\n  " + otherClasses.joinToString("\n  ") {
                    "$it: values=${en[it]?.sorted()} values-de=${de[it]?.sorted()}"
                }
        }

        val withoutBoth = en.keys.filter { !en.getValue(it).containsAll(listOf("one", "other")) }.sorted()
        assert(withoutBoth.isEmpty()) {
            "Diese Mengenformen haben nicht beide Klassen `one` und `other` — dann " +
                "steht auch bei genau einem Treffer die Mehrzahl da:\n  " +
                withoutBoth.joinToString("\n  ")
        }
    }

    /**
     * Gleicher Text in beiden Dateien heisst: nicht uebersetzt.
     *
     * ── Warum der Test oben das nicht faengt ─────────────────
     *
     * `every text is in both language files` vergleicht NAMEN. Die zehn
     * Texte der Preisalarm-Rubrik standen brav in beiden Dateien — nur trug
     * die deutsche denselben englischen Satz; die deutsche App zeigte „rises above".
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
    fun `no text stays untranslated in both languages`() {
        // Begriffe, Eigennamen und Formatvorlagen, die in beiden Sprachen
        // gleich lauten. Jeder Eintrag ist eine Entscheidung, keine Nachsicht.
        val gewolltGleich = setOf(
            // Reines Format „Aktion: Name“ für Screenreader, ohne Wörter.
            "aktion_fuer",
            "acq_total_quantity", "app_name", "catalog_sort_name", "chart_period_max",
            "comparison_barcode_label", "csv_ok_count",
            "detail_section_item", "finance_filter_sets",
            "finance_grand_total", "finance_section_sets", "finance_total_sets",
            "gallery_quantity_badge", "gallery_sort_name", "nav_sets",
            // Listenfuss wie finance_grand_total; „Set 10305-1“ für TalkBack.
            "vouchers_total", "cd_set_nummer",
            "monitoring_theme",
            "monitoring_vorwaermen_roaming",
            // System und Server heissen in beiden Sprachen so.
            "nav_group_server", "settings_hell_system",
            "common_ok", "common_pdf", "common_hours_short", "common_times",
            "partslist_rb_prefix",
            "setup_build",
            "setup_url_placeholder",
            // PIN ist in beiden Sprachen PIN — ein Begriff, kein Satz.
            "vouchers_pin",
            // Reine Rahmen ohne eigenen Text: Seit die zehn
            // PluralsCandidate-Befunde behoben sind, setzen diese beiden einen
            // Satz aus Mengenform-Bruchstuecken zusammen. Sie enthalten nur
            // Platzhalter und Satzzeichen — uebersetzt wird in den <plurals>.
            "partslist_summary", "csv_upload_result",
            // Dazugekommen mit dem Gutschein-Import (Stueck 3): auch ein
            // reiner Rahmen, „%1$s, %2$s". Die beiden Stuecke darin sind die
            // BESTEHENDEN Mengenformen der CSV-Importe (csv_upload_new,
            // csv_upload_updated) — uebersetzt wird dort.
            "vouchers_import_done",
            // Die Rueckmeldung der Guthaben-Abfrage: „%1$s: %2$s" — Nummer und
            // Betrag, kein eigenes Wort. Uebersetzt ist daran nichts, und der
            // Betrag kommt formatiert von LEGO oder aus „%.2f %s".
            "vouchers_balance_done",
            // „Filter“ ist auch im Deutschen das Wort für den Knopf und das Blatt.
            "filter_button", "filter_title",
            // Zähler „5/24“ unter dem Fingerabdruckfeld: nur Zahlen.
            "zert_eingabe_zaehler",
            // Eine Sprache heisst in der Auswahl, wie sie sich selbst nennt (FormsAndMarginsTest).
            "settings_language_en", "settings_language_de",
        )

        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
        assert(en.size > 300) { "Zu wenige Texte gefunden (${en.size}) — Muster veraltet?" }

        val gleich = en.keys.filter { it in de && en[it] == de[it] }.toSet()
        val untranslated = (gleich - gewolltGleich).sorted()
        assert(untranslated.isEmpty()) {
            "Diese Texte stehen auf Deutsch wortgleich wie auf Englisch — sehr " +
                "wahrscheinlich beim Anlegen kopiert und nicht uebersetzt:\n  " +
                untranslated.joinToString("\n  ") { "$it = \"${en[it]}\"" } +
                "\nIst er wirklich in beiden Sprachen gleich, gehoert er in `gewolltGleich`."
        }
        val veraltet = (gewolltGleich - gleich).sorted()
        assert(veraltet.isEmpty()) {
            "Diese Eintraege in `gewolltGleich` stimmen nicht mehr (Text unterscheidet " +
                "sich inzwischen oder Name ist weg): " + veraltet.joinToString(", ") + " — raus damit."
        }
    }

    /**
     * Name → Text. Das Muster verlangt ein `">` direkt hinter dem Namen und
     * überspringt damit jeden Eintrag mit zusätzlichem Attribut.
     *
     * NACHTRAG 161: Bis hierhin war das genau ein Eintrag, `lang_code
     * translatable="false"`. Den Zusatz gibt es nicht mehr — Lint hatte ihn als
     * `Untranslatable` beanstandet, und zu Recht: Die Zeichenkette gibt den Code
     * der aktuellen Sprache und ist absichtlich je Sprachdatei anders, also
     * sehr wohl zu übersetzen. Sie fällt jetzt in den Vergleich unten und ist
     * dort harmlos, weil "en" und "de" sich unterscheiden.
     */
    private fun texts(datei: String): Map<String, String> =
        Regex("""<string name="([^"]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(Quellen.res, "$datei").readText())
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
    /**
     * Ein Bereich, ein Name — wie im Web (monitor.title): „Hintergrundarbeiten“
     * bzw. „Background jobs“ (wie nav.monitoring im Web) in Titel, Navigation und Menü, kein „Monitoring“.
     * Gegenprobe: nav_monitoring auf Englisch wieder „Monitoring“ → rot.
     */
    @Test
    fun `the area is called Hintergrundarbeiten everywhere`() {
        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
        for (k in listOf("nav_monitoring", "main_menu_monitoring")) {
            assert(de[k] == "Hintergrundarbeiten") { "$k (de) = ${de[k]}" }
            assert(en[k] == "Background jobs") { "$k (en) = ${en[k]}" }
        }
        val alt = (en + de.mapKeys { "de:" + it.key }).filterValues { it.contains("Monitoring") }
        assert(alt.isEmpty()) { "Noch „Monitoring“ in: ${alt.keys}" }
    }

    /**
     * Schweizer Schreibung und ein Wort je Sache: kein „ß“, keine Abkürzung „ggü.“, die
     * App-Version heisst „Version“ (nicht „Fassung“), und die Überschrift der Anmeldung
     * ist nicht derselbe Text wie ihr Knopf.
     * Gegenprobe: scanner_close wieder „Schließen“ → rot.
     */
    @Test
    fun `German texts in Swiss spelling and unambiguous`() {
        val de = texts("values-de/strings.xml")
        val falsch = de.filterValues { "ß" in it || "ggü." in it || Regex("""\bFassung\b""").containsMatchIn(it) }
        assert(falsch.isEmpty()) { "Nicht in Schweizer Schreibung oder mit altem Begriff: ${falsch.keys}" }
        for (t in listOf(de, texts("values/strings.xml"))) {
            assert(t["login_title"] != t["login_button"]) { "Überschrift und Knopf der Anmeldung gleich: ${t["login_title"]}" }
        }
    }

    /**
     * Ein Wort je Sache (Glossar): „Setnummer“, Listenfüsse „Total“, „Kaufsumme“ für den
     * Einstand; englisch „Sign in/out“, „Profit/loss“, „administrator rights“.
     * Gegenprobe (gegenproben/begriff-set-nummer.patch): gallery_set_number wieder
     * „Set-Nummer“ → rot. Ebenso versalien-im-text (PREISSPEICHER) und
     * vorgabe-mit-strichen („— Global default —“).
     */
    @Test
    fun `one term per thing in both languages`() {
        val verboten = mapOf(
            // Sorten wie in der Web-App, nicht „Teileart“; „Stück gesamt“ hiess in der Galerie „Teile“.
            "values-de/strings.xml" to listOf(Regex("Set-Nummer"), Regex("""\bSumme\b"""), Regex("Kauf gesamt"),
                Regex("Teileart|Figurenart|Stück gesamt|Webapp|Android App")),
            "values/strings.xml" to listOf(Regex("""(?i)\blog(?:ged)? (?:in|out)\b"""), Regex("Gain/loss"),
                Regex("""\badmin rights\b""")),
        )
        // Auch keine Form im Wort: Versalien setzt Abschnittstitel (vorgelesen wie geschrieben),
        // und eine Wahl in Gedankenstrichen las sich als Platzhalter.
        val form = listOf(Regex("""^\p{Lu}[\p{Lu}\- ]{4,}$"""), Regex("""^— .* —$"""))
        val findings = verboten.flatMap { (datei, pattern) ->
            texts(datei).filterValues { t -> (pattern + form).any { it.containsMatchIn(t) } }.map { "$datei ${it.key}: ${it.value}" }
        }
        assert(findings.isEmpty()) { "Abweichender Begriff:\n  " + findings.joinToString("\n  ") }
        checkRolesNames()
    }

    /**
     * Die Rollen heissen wie im Web „Standard“ und „Administrator“, auch in Zusammensetzungen
     * („Administratorrechte“); „Verwalter“ und „Benutzer“ als Rolle sind abgelöst.
     * Gegenprobe (gegenproben/rolle-verwalter.patch): zf_pflicht_kurz wieder „Verwalterrechte …“ → rot.
     */
    private fun checkRolesNames() {
        val de = texts("values-de/strings.xml")
        val en = texts("values/strings.xml")
        assert(de["zf_pflicht_kurz"]?.startsWith("Administratorrechte") == true) { "zf_pflicht_kurz = ${de["zf_pflicht_kurz"]}" }
        val alt = de.filterValues { Regex("""Verwalter|\bBenutzer(?!name)""").containsMatchIn(it) }.keys +
            en.filterValues { Regex("""\b[Aa]dmins?\b""").containsMatchIn(it) }.keys
        assert(alt.isEmpty()) { "Alter Rollenname in: $alt" }
    }

    @Test
    fun `no second name for a common text`() {
        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
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
    fun `no plain text in Text, contentDescription or Toast`() {
        // Was gesucht wird, ist ein LITERAL an einer Stelle, die der Nutzer
        // liest. Bewusst NICHT beanstandet:
        //  - Emoji und Symbole ("👷", "📅") — die sind in jeder Sprache gleich
        //    und stehen absichtlich im Code statt in den Sprachdateien.
        val pattern = listOf(
            Regex("""Text\(\s*"([^"]{3,})"""),
            Regex("""contentDescription\s*=\s*"([^"]{3,})""""),
            Regex("""Toast\.makeText\([^,]+,\s*"([^"]{3,})"""),
        )
        // Eigennamen und Abkürzungen, die in jeder Sprache gleich lauten (z. B. PDF: common_pdf).
        val erlaubt = emptySet<String>()
        val allowedSeen = mutableSetOf<String>()

        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            val s = Quellen.withoutComments(datei.readText())
            for (m in pattern) {
                m.findAll(s).forEach { treffer ->
                    val text = treffer.groupValues[1]
                    if (text in erlaubt) { allowedSeen += text; return@forEach }
                    // Eine offene Klammer ohne schliessende heisst: Der
                    // Ausdruck enthält selbst eine Zeichenkette, und der
                    // Treffer bricht an deren Anführungszeichen ab. So ein
                    // Bruchstück ist nicht beurteilbar — hier wird nicht
                    // geraten, sondern übergangen. Ein echter Parser wäre die
                    // Alternative; für diese Handvoll Fälle lohnt er nicht.
                    if (text.contains(EXPRESSION_ON) && !text.contains("}")) return@forEach
                    // Ausdrücke entfernen, DANN auf Sprache prüfen: Ohne das
                    // zählte der Variablenname in einer Einsetzung als Text und
                    // meldete zwanzig Fehlalarme.
                    val onlyText = text
                        .replace(Regex(EXPRESSION_LANG), "")
                        .replace(Regex(EXPRESSION_SHORT), "")
                    // Mindestens zwei aufeinanderfolgende Buchstaben — das
                    // trennt Sprache von Symbolen und Zahlenformaten.
                    if (!Regex("""\p{L}\p{L}""").containsMatchIn(onlyText)) return@forEach
                    val zeile = s.substring(0, treffer.range.first).count { it == '\n' } + 1
                    fehler += "${datei.name}:$zeile  \"$text\""
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Oberflächentext als Literal statt aus den Sprachdateien:\n  " +
                fehler.joinToString("\n  ")
        }
        val veraltet = (erlaubt - allowedSeen).sorted()
        assert(veraltet.isEmpty()) {
            "Diese Eintraege in `erlaubt` beschreiben nichts mehr: " +
                veraltet.joinToString(", ") +
                " — der Text steht nirgends mehr im Quelltext. Raus damit."
        }
    }
}
