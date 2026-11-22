package ch.brickinventoryapp.ui

import androidx.compose.foundation.shape.CornerSize
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Density
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.theme.Shapes
import org.junit.Assert
import org.junit.Test

/**
 * The dimensions of an inventory tile live in ONE place.
 *
 * ── The finding ──────────────────────────────────────────────────────────────
 * The parts and minifigures tabs show the same grid. The dimensions stood as
 * numbers in both screens:
 *
 *     modifier = Modifier.width(112.dp).height(178.dp)
 *
 * and on top of that the same corner for the image above, twice:
 *
 *     .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
 *
 * Whoever changes one of them today has to find all occurrences. If one is off,
 * the grid breaks or the image overhangs the top corners — and both
 * only show up on a device.
 *
 * ── What was NOT merged ─────────────────────────────────────────
 * Only the geometry. The content of the two cards is different and should
 * stay that way: a different image source (minifigures with fallback to full
 * resolution), a different placeholder, a different quantity badge, and for parts
 * additionally the color dot. The same boundary that AppCard in Shapes.kt
 * already draws — it encapsulates the shell and leaves the inner padding to the caller.
 */
class TileDimensionsTest {

    @Test
    fun `the tile dimensions live only in Shapes`() {
        val numbers = listOf("width(112.dp)", "height(178.dp)", "topStart = 14.dp")
        val violations = mutableListOf<String>()
        for (file in Sources.below("ui")) {
            if (file.name == "Shapes.kt") continue   // that is where they belong
            val src = Sources.withoutComments(file.readText())
            for ((nr, row) in src.lines().withIndex()) {
                for (z in numbers) if (row.contains(z)) {
                    violations += "${file.name}:${nr + 1}  $z"
                }
            }
        }
        assert(violations.isEmpty()) {
            "These places write the tile dimensions as a number:\n  " +
                violations.joinToString("\n  ") +
                "\nThey belong in Shapes (tileWidth/tileHeight/tileImageCorners). " +
                "Two numbers for the same grid can drift apart, and that " +
                "only shows on the device."
        }
    }

    /**
     */
    @Test
    fun `the common tile gets its dimensions there`() {
        val user = Sources.below("ui").filter { file ->
            val src = Sources.withoutComments(file.readText())
            src.contains("Shapes.tileWidth") && src.contains("Shapes.tileHeight")
        }
        assert(user.size == 1) {
            "The tile dimensions stand in ${user.size} files (${user.joinToString { it.name }}) " +
                "— exactly one is expected: the shared ManualTile. More means " +
                "there are two tiles again; none means it is gone or renamed."
        }
        assert(user.single().name == "ManualItemComposables.kt") {
            "the dimensions stand in ${user.single().name} instead of in ManualItemComposables.kt"
        }
    }

    /**
     * A card with text has a minimum, not a fixed height: with large
     * system font size the text grows, and a fixed height would cut it off.
     * Image areas IN the card may be fixed.
     *
     * Counter-check (measured on Oct 28, 2026, kotlinc): the set card back with
     * `Modifier.height(272.dp)` → red with „GalleryCard.kt …“.
     */
    @Test
    fun `cards have no fixed height`() {
        val card = Regex("""\b(Card|AppCard|OutlinedCard|ElevatedCard)\(""")
        val fixedHeight = Regex("""modifier\s*=\s*Modifier[^\n]*?\.height\(""")
        val violations = mutableListOf<String>()
        var cards = 0
        for (file in Sources.below("ui")) {
            val rows = Sources.withoutComments(file.readText()).lines()
            for ((nr, row) in rows.withIndex()) {
                if (!card.containsMatchIn(row)) continue
                cards++
                // The card's modifier sits in its first argument lines.
                val header = rows.subList(nr, minOf(nr + 6, rows.size))
                // Without content (`) {}`) it's a placeholder: its fixed height
                // keeps the list steady until the page arrives (CatalogScrubberTest).
                if (header.any { it.trim() == ") {}" }) continue
                val hits = header.indexOfFirst { fixedHeight.containsMatchIn(it) }
                if (hits >= 0) violations += "${file.name}:${nr + hits + 1}"
            }
        }
        Assert.assertTrue("No card found — pattern outdated?", cards >= 10)
        Assert.assertTrue("fixed card height instead of heightIn(min = …): $violations", violations.isEmpty())
    }

    /**
     * The same for buttons, chips and clickable surfaces: they carry text.
     *
     * Counter-check (measured on Oct 28, 2026, kotlinc): the period chips in
     * PortfolioChart.kt back with `Modifier.height(28.dp)` → red with
     * „PortfolioChart.kt …“.
     */
    @Test
    fun `buttons and chips have no fixed height`() {
        val button = Regex("""\b(Button|OutlinedButton|TextButton|FilledTonalButton|FilterChip|SelectionChip|AssistChip|InputChip|Surface)\(""")
        val fixedHeight = Regex("""modifier\s*=\s*Modifier\.height\(""")
        val violations = mutableListOf<String>()
        var buttons = 0
        for (file in Sources.below("ui")) {
            val rows = Sources.withoutComments(file.readText()).lines()
            for ((nr, row) in rows.withIndex()) {
                if (!button.containsMatchIn(row)) continue
                buttons++
                val header = rows.subList(nr, minOf(nr + 6, rows.size))
                val hits = header.indexOfFirst { fixedHeight.containsMatchIn(it) }
                if (hits >= 0) violations += "${file.name}:${nr + hits + 1}"
            }
        }
        Assert.assertTrue("No buttons found — pattern outdated?", buttons >= 20)
        Assert.assertTrue("fixed height on a button or chip instead of heightIn(min = …): $violations", violations.isEmpty())
    }

    /**
     * The tile image sits flush at the top of the card: its top corners have the
     * bar's radius, none at the bottom. Counter-check kachelbild-eigener-radius (12.dp; kotlinc) → red here.
     */
    @Test
    fun `image corner and card shape share the radius`() {
        val size = Size(112f, 208f)
        val density = Density(2.75f)
        fun px(corner: CornerSize) = corner.toPx(size, density)
        Assert.assertEquals(px(Shapes.bar.topStart), px(Shapes.tileImageCorners.topStart), 0f)
        Assert.assertEquals(px(Shapes.bar.topEnd), px(Shapes.tileImageCorners.topEnd), 0f)
        Assert.assertTrue("the bar is round", px(Shapes.bar.topStart) > 0f)
        Assert.assertEquals("at the bottom the image has no corner", 0f, px(Shapes.tileImageCorners.bottomStart), 0f)
    }
}
