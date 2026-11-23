package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Controls that consist ONLY of an icon need a label.
 *
 * ── What this test does NOT require ─────────────────────────────────────────
 * `contentDescription = null` on an icon NEXT to a text is right and
 * stays: otherwise TalkBack reads the same thing twice („Suchen, Suchen“). The
 * test therefore only picks up icons INSIDE an IconButton — there the
 * icon is the only thing the button has to offer.
 */
class IconButtonLabelTest {

    // Note: the check logic also picks up FilledTonalIconButton & co. — their
    // name contains "IconButton". That is intentional and, while writing this
    // test, brought to light six further places nobody had thought of
    // before: the quantity buttons (+/-) in the two detail views and two
    // edit buttons in the monitoring. The quantity buttons carried "+" and "-"

    private fun screens(): List<File> =
        Sources.root
            .walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            .also {
                // Lower bound: an empty file walk lets every
                // collective check below pass silently.
                check(it.size >= 20) { "Too few Kotlin files found (${'$'}{it.size}) — path outdated?" }
            }

    @Test
    fun `every IconButton has a label`() {
        val withoutLabel = mutableListOf<String>()

        for (file in screens()) {
            val rows = file.readText().lines()
            rows.forEachIndexed { i, row ->
                if (!row.contains("IconButton(")) return@forEachIndexed
                // The icon call stands on the same or one of the next
                // lines — multi-line calls are the normal case.
                //
                // A window over the next ten lines instead of a fixed
                // number of characters from `Icon(`: a first attempt cut at 300
                // characters and therefore reported the password button as
                // unlabelled, although the label — behind two
                // comment lines — stood directly below. A test that
                // complains about correct code gets switched off instead of followed.
                val block = rows.subList(i, minOf(i + 10, rows.size)).joinToString("\n")
                if (!block.contains("Icon(")) return@forEachIndexed
                val labeled = block.contains("stringResource") ||
                    block.contains("contentDescription =")
                if (!labeled) withoutLabel += "${file.name}:${i + 1}"
            }
        }

        assert(withoutLabel.isEmpty()) {
            "IconButton without a label — TalkBack only says “button” there: $withoutLabel"
        }
    }

    /**
     * Every pure icon button lies in WithTooltip: sighted users could only guess filter and
     * sort (both lines), Material shows the name on long press.
     * The call stands on the same line or up to two lines above. The only exception is
     * WithTooltip.kt itself, which gets the button as content.
     *
     * Counter-check (counter-checks/icon-button-without-tooltip.patch): the back arrow of the
     * subpage without WithTooltip → red with Unterseite.kt.
     */
    @Test
    fun `every icon button shows its name as a tooltip`() {
        val without = mutableListOf<String>()
        for (file in screens()) {
            if (file.name == "WithTooltip.kt") continue
            val rows = Sources.withoutComments(file.readText()).lines()
            rows.forEachIndexed { i, row ->
                if (!row.contains("IconButton(")) return@forEachIndexed
                val before = rows.subList(maxOf(0, i - 2), i + 1).joinToString("\n")
                if (!before.contains("WithTooltip(")) without += "${file.name}:${i + 1}"
            }
        }
        assert(without.isEmpty()) { "icon button without a tooltip (WithTooltip): $without" }
    }

    @Test
    fun `the labels exist in both languages`() {
        // A missing entry in values-de does not lead to an error but
        // silently to the English text — exactly the kind of gap nobody reports.
        val en = File(Sources.res, "values/strings.xml").readText()
        val de = File(Sources.res, "values-de/strings.xml").readText()
        val names = listOf(
            "cd_search_clear", "cd_password_show", "cd_password_hide", "cd_set_delete",
            "cd_qty_increase", "cd_qty_decrease", "cd_edit_cache_ttl", "cd_edit_limits",
        )
        for (name in names) {
            assert(en.contains("\"$name\"")) { "values/strings.xml: $name missing" }
            assert(de.contains("\"$name\"")) { "values-de/strings.xml: $name missing" }
        }
    }

    // Counter-check (measured on 27.10.): in WantedListRow.kt the
    // `role = Role.Button` removed again → red with exactly this place.
    @Test
    fun `every clickable names its role`() {
        // Without a role TalkBack says nothing about a clickable card
        // being tappable.
        val withoutRole = mutableListOf<String>()
        for (f in screens()) {
            // Glance (home screen widget) knows no role: there it becomes a
            // RemoteViews area that the launcher itself announces as tappable.
            if (f.readText().contains("import androidx.glance.")) continue
            // Empty import lines instead of removing them: the line numbers stay right.
            val s = f.readText().lines().joinToString("\n") { if (it.startsWith("import ")) "" else it }
            Regex("""\.clickable(\((?:[^()]|\([^()]*\))*\))?""").findAll(s).forEach { m ->
                if (!m.value.contains("role =")) withoutRole += "${f.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
            }
        }
        assert(withoutRole.isEmpty()) { "clickable without role: $withoutRole" }
    }
}
