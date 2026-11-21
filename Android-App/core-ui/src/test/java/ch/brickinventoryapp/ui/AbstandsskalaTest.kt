package ch.brickinventoryapp.ui

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Spacings and font sizes come from the scale — and the exceptions
 * get fewer, never more.
 *
 * ── Why a RATCHET and not a hard rule ────────────────────────────────
 *
 * Measured before anything was changed: the app used no 4- or
 * 8-grid, but a 2-dp continuum — 8 (106 times), 6 (60), 12 (54),
 * 4 (51), 16 (44), 10 (41), 2 (28), 14 (26) … On the usual scale
 * (2/4/8/12/16/24/32) 304 of these spots fall exactly; 175 do not.
 *
 * The exact ones were converted — proven without any shift: the
 * distribution of the actual values is the same before and after the conversion.
 *
 * The rest were NOT. Pulling a 6 to 4 or 8 is not cleanup
 * but a DESIGN change: the spot shifts visibly. That is
 * decided by whoever has the app in front of them, not by whoever rewrites the source —
 * and with 60 spots for the 6 alone it's also not a small thing.
 *
 * A hard rule ("scale values only") would therefore either go red right away
 * or would have to list 181 exceptions — and an exception list of that
 * length nobody reads anymore. The ratchet solves both: it holds the
 * current state, lets it fall, and trips as soon as it rises. New screens get
 * the scale this way, without touching the existing ones.
 *
 * ── What is explicitly NOT included ─────────────────────────────────
 *
 * `size(16.dp)` on an icon, a card's height, a stroke width —
 * those are SIZES, not spacings. A spacing token there would be wrong:
 * whoever changes the tile height doesn't want to change all inner padding with it.
 * Only padding, Arrangement.spacedBy, PaddingValues and
 * Spacer are checked.
 */
class AbstandsskalaTest {

    /** Only real SPACING spots — not sizes. See KDoc. */
    private val spacingPattern = listOf(
        Regex("""\bspacedBy\((\d+)\.dp\)"""),
        Regex("""\bpadding\((\d+)\.dp\)"""),
        Regex("""\bPaddingValues\((\d+)\.dp\)"""),
        Regex("""\b(?:horizontal|vertical|top|bottom|start|end) = (\d+)\.dp"""),
        Regex("""\bSpacer\(Modifier\.(?:width|height)\((\d+)\.dp\)\)"""),
    )
    private val fontPattern = Regex("""\bfontSize = (\d+)\.sp""")

    /** The screens — ui/theme itself is the scale and doesn't count. */
    private fun quellen(): List<Pair<String, String>> =
        Quellen.unter("ui")
            .filter { "theme" !in it.path.split(File.separator) }
            .map { it.name to Quellen.withoutComments(it.readText()) }
            .toList()

    private fun zaehle(pattern: List<Regex>): Int =
        quellen().sumOf { (_, s) -> pattern.sumOf { it.findAll(s).count() } }

    @Test
    fun `the scale is used at all`() {
        // ── Self-check: does the search even find anything? ───────────
        //
        // That is the actual point of this check. If the folder is
        // renamed or `quellen()` no longer catches it, the ratchet
        // below counts ZERO — and zero is less than any limit. It would
        // then stay green forever, without ever looking at anything again.
        //
        // An earlier version of this reasoning stood here: that the ratchet
        // wouldn't notice a REVERTED conversion. That is wrong, and the counter-check
        // showed it: the ratchet counts every number at a spacing spot,
        // not only those next to the scale. Whoever replaces a token with its
        // old number makes the number rise and gets caught. The wrong
        // reasoning stays here, because a measured refutation is worth more
        // than quietly removing it.
        //
        // The second number below stays anyway: it records how far the
        // conversion had progressed, and makes a creeping reversal
        // across many files visible that the ratchet does report per file,
        // but doesn't tally up in total.
        val alle = quellen()
        assert(alle.size >= 30) { "Nur ${alle.size} Bildschirmdateien gefunden — Ordner umbenannt?" }
        val text = alle.joinToString("\n") { it.second }
        val abst = Regex("""\bAbstaende\.\w+""").findAll(text).count()
        val rollen = Regex("""\bMaterialTheme\.typography\.\w+""").findAll(text).count()
        // GEMESSEN: 305 Abstands-Token beim Anlegen, 336 Typografie-Rollen am 28.10.
        assert(abst >= 280) {
            "Nur $abst Abstands-Token im Baum (gemessen waren es 305). Wurde die " +
                "Umstellung rueckgaengig gemacht? Die Ratsche unten faellt das nicht auf."
        }
        assert(rollen >= 300) {
            "Nur $rollen Typografie-Rollen im Baum (gemessen waren es 336). Siehe oben."
        }
    }

    /**
     * Font sizes come from ONE scale, Material's. Until Oct 28, `Schrift.*`
     * ran alongside it with its own steps (10/12/14/16/20/24 sp).
     *
     * Counter-checks (measured on Oct 28, copy of the source tree, in TabellenZeile.kt
     * `style = MaterialTheme.typography.bodySmall` replaced):
     *   by `fontSize = Schrift.klein` → red here
     *   by `fontSize = 12.sp` → red in „die Zahl der Schriftgroessen …"
     */
    @Test
    fun `there is only Material's type scale`() {
        val zweite = quellen().filter { (_, s) -> Regex("""\bSchrift\.\w+""").containsMatchIn(s) }.map { it.first }
        assert(zweite.isEmpty()) { "Zweite Schriftskala benutzt in: $zweite — nimm MaterialTheme.typography." }
        assert(!File(Quellen.root, "ui/theme/Schrift.kt").exists()) {
            "ui/theme/Schrift.kt ist wieder da."
        }
    }

    @Test
    fun `the number of spacings still written as numbers only sinks`() {
        // MEASURED when created: 181, then 180 (the design picker in
        // MonitoringSections moved onto the scale), now 178. At the very
        // top are 6 (59 times), 10 (41) and
        // 14 (26) — the three values that don't exist on a two-step scale.
        //
        // 180 -> 178: the two button rows in the catalog and the
        // watchlist detail needed smaller inner padding so that two
        // buttons fit side by side. The first attempt wrote
        // `vertical = 8.dp` for that — and exactly that is what this ratchet
        // caught before it reached main. It is `Abstaende.klein`, the same value
        // with a name; the three new spots therefore don't count, and one
        // old one drops out.
        //
        // 178 -> 176: the settings rework (Oct 16) took along two bare
        // numbers — the 10 dp between the fourteen cards (now
        // Abstaende.gross between four) and the inner padding of the
        // „Aktuelle Einstellungen" box, which was dropped without replacement.
        //
        // This number may FALL if someone deliberately decides to move one of
        // these groups onto the scale. It may not rise: a new
        // screen has no reason to invent a spacing that doesn't
        // exist yet.
        val ist = zaehle(spacingPattern)
        assert(ist <= 176) {
            "$ist Abstaende stehen noch als Zahl da, gemessen waren es 176. " +
                "Ein neuer Wert ausserhalb von Abstaende gehoert begruendet — oder " +
                "in die Skala. Sinkt die Zahl, gehoert sie hier nachgezogen."
        }
    }

    @Test
    fun `the number of font sizes still written as numbers only sinks`() {
        // MEASURED when created: 55. Biggest item is 13.sp (22 times) —
        // right next to 12.sp (24 times). Two sizes that differ by one
        // point are not readable as a difference side by side; that
        // is the candidate you'd merge first.
        //
        // 54 -> 51: the three chips in the filter row
        // (HouseholdComposables) were at 13.sp and are now at
        // Schrift.klein. The trigger was a fourth chip next to them — the
        // storage location filter. Two sizes next to each other that differ by one
        // point are exactly the case the paragraph above
        // describes; leaving it as is when adding the fourth
        // would have pushed the number to 55.
        //
        // 55 -> 54: exactly this candidate fell twice.
        //
        // 51 -> 2 (Oct 27): the raw sizes were converted to Material
        // scale roles (bodyMedium, labelSmall, titleMedium …).
        //
        // 2 -> 0 (Oct 28): the portfolio chart's axes now also take
        // labelSmall instead of 8 sp.
        val ist = zaehle(listOf(fontPattern))
        assert(ist <= 0) {
            "$ist Schriftgroessen stehen als Zahl da. Nimm eine Rolle aus " +
                "MaterialTheme.typography."
        }
    }
}
