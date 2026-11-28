package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Every text stands in BOTH languages, and no text stands in the source.
 */
class StringResourceParityTest {

    // As constants so that the dollar does not stand in a string template
    // — in Kotlin it would have to be escaped awkwardly there, and exactly
    // such escapes have twice in this series let a test
    // silently check something other than intended.
    private val DOLLAR = '\u0024'
    private val EXPRESSION_ON = "$DOLLAR{"
    private val EXPRESSION_LANG = "\\$DOLLAR\\{[^}]*\\}"
    private val EXPRESSION_SHORT = "\\$DOLLAR\\w+"

    private fun key(file: String): Set<String> =
        Regex("""<string name="([^"]+)"""")
            .findAll(File(Sources.res, "$file").readText())
            .map { it.groupValues[1] }.toSet()

    @Test
    fun `every text is in both language files`() {
        val en = key("values/strings.xml")
        val de = key("values-de/strings.xml")
        assert(en.size > 300) { "Too few texts found (${en.size}) — pattern outdated?" }

        val onlyEn = (en - de).sorted()
        val onlyDe = (de - en).sorted()
        assert(onlyEn.isEmpty()) {
            "Only in values/, missing in German (Android silently shows English there):\n  " +
                onlyEn.joinToString("\n  ")
        }
        // The opposite direction is more harmless, but just as much an error: a
        // German entry without an English counterpart is dead ballast,
        // because values/ is the default language and is always read.
        assert(onlyDe.isEmpty()) {
            "Only in values-de/, without a counterpart in values/:\n  " + onlyDe.joinToString("\n  ")
        }
    }

    /** Name → quantity classes ("one", "other", …) of a `<plurals>`. */
    private fun quantityShapes(file: String): Map<String, Set<String>> =
        Regex("""<plurals name="([^"]+)">(.*?)</plurals>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(Sources.res, "$file").readText())
            .associate { m ->
                m.groupValues[1] to Regex("""quantity="([^"]+)"""")
                    .findAll(m.groupValues[2]).map { it.groupValues[1] }.toSet()
            }

    /**
     * Plural forms: both files, the same classes.
     *
     * ── Why this check exists ──────────────────────────────
     *
     * The check above searches `<string name=`. `<plurals>` was invisible to it —
     * as long as there were none, that was no hole. With fixing the ten
     * PluralsCandidate findings there are sixteen, and with that a missing
     * German singular form would be exactly the error the file above describes:
     *
     * Therefore three things are checked:
     *   1. The same names in both files.
     *   2. The same quantity classes per name — a German `<plurals>` without
     *      `one` looks complete and is not.
     *
     * Counter-checks (performed, in the same logic against the real files
     * and four falsified versions):
     *   the real files                  -> green (16 plural forms)
     *   German singular form removed    -> RED
     *   German plural form gone entirely -> RED
     *   plural form only in German      -> RED
     *   English plural form without one -> RED
     */
    @Test
    fun `every plural form is in both language files with the same classes`() {
        val en = quantityShapes("values/strings.xml")
        val de = quantityShapes("values-de/strings.xml")

        // Self-proof against the silent zero: without hits everything below would run
        // into nothing and still be green.
        assert(en.isNotEmpty()) {
            "No <plurals> found in values/strings.xml — pattern outdated?"
        }

        val onlyEn = (en.keys - de.keys).sorted()
        assert(onlyEn.isEmpty()) {
            "Plural only in values/, missing in German (Android silently shows " +
                "English there):\n  " + onlyEn.joinToString("\n  ")
        }
        val onlyDe = (de.keys - en.keys).sorted()
        assert(onlyDe.isEmpty()) {
            "Plural only in values-de/, without a counterpart in values/:\n  " +
                onlyDe.joinToString("\n  ")
        }

        val otherClasses = en.keys.filter { it in de && en[it] != de[it] }.sorted()
        assert(otherClasses.isEmpty()) {
            "These plurals do NOT have the same quantity classes in the two " +
                "files — the missing version silently falls back to English " +
                "there:\n  " + otherClasses.joinToString("\n  ") {
                    "$it: values=${en[it]?.sorted()} values-de=${de[it]?.sorted()}"
                }
        }

        val withoutBoth = en.keys.filter { !en.getValue(it).containsAll(listOf("one", "other")) }.sorted()
        assert(withoutBoth.isEmpty()) {
            "These plurals do not have both classes `one` and `other` — then " +
                "the plural is shown even for exactly one hit:\n  " +
                withoutBoth.joinToString("\n  ")
        }
    }

    /**
     * The same text in both files means: not translated.
     *
     * ── Why the test above does not catch this ─────────────────
     *
     * `every text is in both language files` compares NAMES. The ten
     * texts of the price alert section stood dutifully in both files — only
     * the German one carried the same English sentence; the German app showed „rises above“.
     *
     * The error is not the forgetting but its form: whoever creates a new
     * text copies the block into the second file — and then does not
     * translate it. Both files look complete afterwards. No switch
     * is on red, no line is missing. That is why this test does not check
     * completeness but difference.
     *
     * ── Why a list and not a heuristic ───────────────────────────────────────
     *
     * RE-MEASURED, after the translation 30 entries still stood the same in both
     * files, and all 30 rightly: „Sets“, „Scan“, „OK“, „Details“,
     * format templates like `×%1${DOLLAR}d`, the address in the placeholder. A
     * heuristic („at least two real words“) would have found eight of the ten
     * alert texts and in return wrongly reported `app_name` and `monitoring_title`
     * — so both wrong: incomplete AND loud.
     *
     * The list is instead a claim that every entry carries
     * individually: „this text reads the same in both languages, and that is intended“
     * . New texts do not get in by themselves — that is exactly the
     * purpose. And as with `allowed` further below the test checks the list
     * itself too: an entry that no longer applies is thrown out instead of
     * staying as an old decision that nobody looks at any more.
     */
    @Test
    fun `no text stays untranslated in both languages`() {
        // Terms, proper names and format templates that read the same in both
        // languages. Every entry is a decision, not an indulgence.
        val intendedEqual = setOf(
            // Pure format „Aktion: Name“ for screen readers, without words.
            "action_for",
            "acq_total_quantity", "app_name", "catalog_sort_name", "chart_period_max",
            "comparison_barcode_label", "csv_ok_count",
            "detail_section_item", "finance_filter_sets",
            "finance_grand_total", "finance_section_sets", "finance_total_sets",
            "gallery_quantity_badge", "gallery_sort_name", "nav_sets",
            // List footer like finance_grand_total; „Set 10305-1“ for TalkBack.
            "vouchers_total", "cd_set_number",
            "monitoring_theme",
            "monitoring_prewarm_roaming",
            // System and server are called so in both languages.
            "nav_group_server", "settings_light_system",
            "common_ok", "common_pdf", "common_hours_short", "common_times",
            "partslist_rb_prefix",
            "setup_build",
            "setup_url_placeholder",
            // PIN is PIN in both languages — a term, not a sentence.
            "vouchers_pin",
            // Pure frames without own text: since the ten
            // PluralsCandidate findings are fixed, these two assemble a
            // sentence from plural form fragments. They contain only
            // placeholders and punctuation — translation happens in the <plurals>.
            "partslist_summary", "csv_upload_result",
            // Added with the voucher import (piece 3): also a
            // pure frame, „%1$s, %2$s“. The two pieces in it are the
            // EXISTING plural forms of the CSV imports (csv_upload_new,
            // csv_upload_updated) — translation happens there.
            "vouchers_import_done",
            // The response of the balance query: „%1$s: %2$s“ — number and
            // amount, no own word. Nothing in it is translated, and the
            // amount comes formatted from LEGO or from „%.2f %s“.
            "vouchers_balance_done",
            // „Filter“ is also in German the word for the button and the sheet.
            "filter_button", "filter_title",
            // Counter „5/24“ below the fingerprint field: only numbers.
            "cert_input_counter",
            // A language is called in the selection what it calls itself (FormsAndMarginsTest).
            "settings_language_en", "settings_language_de",
        )

        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
        assert(en.size > 300) { "Too few texts found (${en.size}) — pattern outdated?" }

        val equal = en.keys.filter { it in de && en[it] == de[it] }.toSet()
        val untranslated = (equal - intendedEqual).sorted()
        assert(untranslated.isEmpty()) {
            "These texts are word for word the same in German as in English — very " +
                "likely copied when created and not translated:\n  " +
                untranslated.joinToString("\n  ") { "$it = \"${en[it]}\"" } +
                "\nIf it really is the same in both languages, it belongs in `intendedEqual`."
        }
        val stale = (intendedEqual - equal).sorted()
        assert(stale.isEmpty()) {
            "These entries in `intendedEqual` no longer hold (the text differs " +
                "by now or the name is gone): " + stale.joinToString(", ") + " — remove them."
        }
    }

    /**
     * Name → text. The pattern requires a `">` directly after the name and
     * thus skips every entry with an additional attribute.
     *
     * Until recently that was exactly one entry, `lang_code
     * translatable="false"`. The addition no longer exists — Lint had flagged it as
     * `Untranslatable`, and rightly: the string returns the code
     * of the current language and is deliberately different per language file, so
     * very much to be translated. It now falls into the comparison below and is
     * harmless there because "en" and "de" differ.
     */
    private fun texts(file: String): Map<String, String> =
        Regex("""<string name="([^"]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(Sources.res, "$file").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }

    /**
     * What has a `common_` name does not stand again under a second one.
     *
     * ── Why this is not an invented rule ─────────────────────────────────────
     *
     * The `common_` names already exist — `common_delete`, `common_cancel`,
     * `common_quantity`, `common_back`, `common_condition`. Whoever created them
     * has already made the decision „this is ONE text“. It was just not
     * carried through: RE-MEASURED, sixteen further names stood next to them
     * with the same word in BOTH languages — five times „Löschen“,
     * five times „Abbrechen“, four times „Anzahl“, twice „Zurück“.
     *
     * What that costs is not the space but the drifting apart: whoever changes
     * „Anzahl“ to „Menge“ changes it in one place, and afterwards
     * the same field is called differently in the parts tab than in the figures tab. Exactly that
     * should not happen with two UIs that should look the same.
     *
     * Deliberately ONLY against `common_`: „two names with the same value“ alone would be
     * too coarse — `login_title` and `login_button` are both called „Anmelden“ and
     * may change independently. The `common_` name is the sign that
     * someone explicitly wanted the commonality.
     */
    /**
     * One area, one name — as on the web (monitor.title): „Hintergrundarbeiten“
     * or „Background jobs“ (like nav.monitoring on the web) in title, navigation and menu, no „Monitoring“.
     * Counter-check: nav_monitoring in English again „Monitoring“ → red.
     */
    @Test
    fun `the area is called BackgroundWork everywhere`() {
        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
        for (k in listOf("nav_monitoring", "main_menu_monitoring")) {
            assert(de[k] == "Hintergrundarbeiten") { "$k (de) = ${de[k]}" }
            assert(en[k] == "Background jobs") { "$k (en) = ${en[k]}" }
        }
        val old = (en + de.mapKeys { "de:" + it.key }).filterValues { it.contains("Monitoring") }
        assert(old.isEmpty()) { "still “Monitoring” in: ${old.keys}" }
    }

    /**
     * Swiss spelling and one word per thing: no „ß“, no abbreviation „ggü.“, the
     * app version is called „Version“ (not „Fassung“), and the heading of the sign-in
     * is not the same text as its button.
     * Counter-check: scanner_close again „Schließen“ → red.
     */
    @Test
    fun `German texts in Swiss spelling and unambiguous`() {
        val de = texts("values-de/strings.xml")
        val wrong = de.filterValues { "ß" in it || "ggü." in it || Regex("""\bFassung\b""").containsMatchIn(it) }
        assert(wrong.isEmpty()) { "not in Swiss spelling or with an old term: ${wrong.keys}" }
        for (t in listOf(de, texts("values/strings.xml"))) {
            assert(t["login_title"] != t["login_button"]) { "heading and button of the sign-in are equal: ${t["login_title"]}" }
        }
    }

    /**
     * One word per thing (glossary): „Setnummer“, list footers „Total“, „Kaufsumme“ for the
     * cost; English „Sign in/out“, „Profit/loss“, „administrator rights“. German typography:
     * „…“ without a space before it, the dash „ – “, no formal „Ihr“ (the app says „du“).
     *
     * Counter-check (counter-checks/term-set-number.patch): gallery_set_number again
     * „Set-Nummer“ → red. Likewise capitals-in-text (PREISSPEICHER),
     * default-with-dashes („— Global default —“) and german-download
     * (pdfview_download_failed again „Download fehlgeschlagen“).
     */
    @Test
    fun `one term per thing in both languages`() {
        val forbidden = mapOf(
            // Kinds as in the web app, not „Teileart“; „Stück gesamt“ was called „Teile“ in the gallery.
            "values-de/strings.xml" to listOf(Regex("Set-Nummer"), Regex("""\bSumme\b"""), Regex("Kauf gesamt"),
                Regex("Teileart|Figurenart|Stück gesamt|Webapp|Android App"),
                Regex("""(?i)(?:down|up)load"""), Regex("Top ?Preise"), Regex("""\bIhr(?:e[mnrs]?)?\b|\bIhnen\b"""),
                Regex(""" …|\.\.\."""), Regex(""" — """)),
            "values/strings.xml" to listOf(Regex("""(?i)\blog(?:ged)? (?:in|out)\b"""), Regex("Gain/loss"),
                Regex("""\badmin rights\b"""), Regex(""" …|\.\.\.""")),
        )
        // No form in the word either: capitals are set by section titles (read out as written),
        // and a choice in dashes read like a placeholder.
        val form = listOf(Regex("""^\p{Lu}[\p{Lu}\- ]{4,}$"""), Regex("""^— .* —$"""))
        val findings = forbidden.flatMap { (file, pattern) ->
            texts(file).filterValues { t -> (pattern + form).any { it.containsMatchIn(t) } }.map { "$file ${it.key}: ${it.value}" }
        }
        assert(findings.isEmpty()) { "Abweichender Begriff:\n  " + findings.joinToString("\n  ") }
        checkRolesNames()
    }

    /**
     * The roles are called as on the web „Standard“ and „Administrator“, also in compounds
     * („Administratorrechte“); „Verwalter“ and „Benutzer“ as a role are superseded.
     * Counter-check (counter-checks/role-manager.patch): zf_required_short again „Verwalterrechte …“ → red.
     */
    private fun checkRolesNames() {
        val de = texts("values-de/strings.xml")
        val en = texts("values/strings.xml")
        assert(de["zf_required_short"]?.startsWith("Administratorrechte") == true) { "zf_required_short = ${de["zf_required_short"]}" }
        val old = de.filterValues { Regex("""Verwalter|\bBenutzer(?!name)""").containsMatchIn(it) }.keys +
            en.filterValues { Regex("""\b[Aa]dmins?\b""").containsMatchIn(it) }.keys
        assert(old.isEmpty()) { "Alter Rollenname in: $old" }
    }

    @Test
    fun `no second name for a common text`() {
        val en = texts("values/strings.xml")
        val de = texts("values-de/strings.xml")
        assert(en.size > 300) { "Too few texts found (${en.size}) — pattern outdated?" }
        val shared = en.keys.filter { it.startsWith("common_") }
        assert(shared.size >= 3) { "Only ${shared.size} common_ names — convention given up?" }

        val double = mutableListOf<String>()
        for (g in shared.sorted()) {
            for (k in en.keys.sorted()) {
                if (k == g || k.startsWith("common_")) continue
                // The same in BOTH languages. Comparing only English
                // would find accidental homophones („Sets“/„Sets“), which
                // differ in German.
                if (en[k] == en[g] && de[k] == de[g]) double += "$k = $g (\"${en[g]}\")"
            }
        }
        assert(double.isEmpty()) {
            "These names carry the same text as a common_ name; take the common_ name:\n  " +
                double.joinToString("\n  ")
        }
    }

    @Test
    fun `no plain text in Text, contentDescription or Toast`() {
        // What is searched for is a LITERAL at a place the user
        // reads. Deliberately NOT flagged:
        //  - emoji and symbols ("👷", "📅") — they are the same in every language
        //    and stand in the code on purpose instead of in the language files.
        val pattern = listOf(
            Regex("""Text\(\s*"([^"]{3,})"""),
            Regex("""contentDescription\s*=\s*"([^"]{3,})""""),
            Regex("""Toast\.makeText\([^,]+,\s*"([^"]{3,})"""),
        )
        // Proper names and abbreviations that read the same in every language (e.g. PDF: common_pdf).
        val allowed = emptySet<String>()
        val allowedSeen = mutableSetOf<String>()

        val error = mutableListOf<String>()
        for (file in Sources.all()) {
            val s = Sources.withoutComments(file.readText())
            for (m in pattern) {
                m.findAll(s).forEach { hits ->
                    val text = hits.groupValues[1]
                    if (text in allowed) { allowedSeen += text; return@forEach }
                    // An open bracket without a closing one means: the
                    // expression itself contains a string, and the
                    // match breaks off at its quotation mark. Such a
                    // fragment cannot be judged — here nothing is
                    // guessed but skipped. A real parser would be the
                    // alternative; for this handful of cases it is not worth it.
                    if (text.contains(EXPRESSION_ON) && !text.contains("}")) return@forEach
                    // Remove expressions, THEN check for language: without that
                    // the variable name in an interpolation counted as text and
                    // reported twenty false alarms.
                    val onlyText = text
                        .replace(Regex(EXPRESSION_LANG), "")
                        .replace(Regex(EXPRESSION_SHORT), "")
                    // At least two consecutive letters — that
                    // separates language from symbols and number formats.
                    if (!Regex("""\p{L}\p{L}""").containsMatchIn(onlyText)) return@forEach
                    val row = s.substring(0, hits.range.first).count { it == '\n' } + 1
                    error += "${file.name}:$row  \"$text\""
                }
            }
        }
        assert(error.isEmpty()) {
            "UI text as a literal instead of from the language files:\n  " +
                error.joinToString("\n  ")
        }
        val stale = (allowed - allowedSeen).sorted()
        assert(stale.isEmpty()) {
            "These entries in `allowed` no longer describe anything: " +
                stale.joinToString(", ") +
                " — the text no longer stands anywhere in the source. Remove them."
        }
    }
}
