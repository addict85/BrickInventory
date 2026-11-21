package ch.brickinventoryapp.ui

import androidx.compose.foundation.shape.CornerSize
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Density
import ch.brickinventoryapp.ui.theme.Formen
import org.junit.Test
import org.junit.Assert
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Masse einer Bestandskachel stehen an EINER Stelle.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Teile- und Minifiguren-Reiter zeigen dasselbe Raster. Die Masse standen als
 * Zahlen in beiden Bildschirmen:
 *
 *     modifier = Modifier.width(112.dp).height(178.dp)
 *
 * und dazu zweimal dieselbe Ecke fuer das Bild oben:
 *
 *     .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
 *
 * Wer eines davon aendert, muss heute alle Fundstellen finden. Weicht eine ab,
 * bricht das Raster oder das Bild steht an den oberen Ecken ueber — und beides
 * faellt erst am Geraet auf.
 *
 * ── Was NICHT zusammengezogen wurde ─────────────────────────────────────────
 * Nur die Geometrie. Der Inhalt der beiden Karten ist verschieden und soll es
 * bleiben: andere Bildquelle (Minifiguren mit Rueckfall auf volle Aufloesung),
 * anderer Platzhalter, andere Mengenmarke, bei den Teilen zusaetzlich der
 * Farbpunkt. Dieselbe Abgrenzung, die AppKarte in Formen.kt schon zieht — sie
 * kapselt die Huelle und laesst den Innenabstand beim Aufrufer.
 */
class TileDimensionsTest {

    @Test
    fun `the tile dimensions live only in Formen`() {
        val zahlen = listOf("width(112.dp)", "height(178.dp)", "topStart = 14.dp")
        val violations = mutableListOf<String>()
        for (datei in Quellen.unter("ui")) {
            if (datei.name == "Formen.kt") continue   // dort gehoeren sie hin
            val src = Quellen.withoutComments(datei.readText())
            for ((nr, zeile) in src.lines().withIndex()) {
                for (z in zahlen) if (zeile.contains(z)) {
                    violations += "${datei.name}:${nr + 1}  $z"
                }
            }
        }
        assert(violations.isEmpty()) {
            "Diese Stellen schreiben die Kachelmasse als Zahl:\n  " +
                violations.joinToString("\n  ") +
                "\nSie gehoeren nach Formen (kachelBreite/kachelHoehe/kachelBildEcken). " +
                "Zwei Zahlen fuer dasselbe Raster koennen auseinanderlaufen, und das " +
                "faellt erst am Geraet auf."
        }
    }

    /**
     */
    @Test
    fun `the common tile gets its dimensions there`() {
        val nutzer = Quellen.unter("ui").filter { datei ->
            val src = Quellen.withoutComments(datei.readText())
            src.contains("Formen.kachelBreite") && src.contains("Formen.kachelHoehe")
        }
        assert(nutzer.size == 1) {
            "Die Kachelmasse stehen in ${nutzer.size} Dateien (${nutzer.joinToString { it.name }}) " +
                "— erwartet wird genau eine: die gemeinsame ManuelleKachel. Mehr heisst, " +
                "es gibt wieder zwei Kacheln; keine heisst, sie ist weg oder umbenannt."
        }
        assert(nutzer.single().name == "ManualItemComposables.kt") {
            "Die Masse stehen in ${nutzer.single().name} statt in ManualItemComposables.kt"
        }
    }

    /**
     * Eine Karte mit Text hat eine Mindest-, keine feste Höhe: Bei grosser
     * Systemschrift wächst der Text, und eine feste Höhe schneidet ihn ab.
     * Bildflächen IN der Karte dürfen fest sein.
     *
     * Gegenprobe (am 28.10.2026 gemessen, kotlinc): die Set-Karte wieder mit
     * `Modifier.height(272.dp)` → rot mit „GalerieKarte.kt …“.
     */
    @Test
    fun `cards have no fixed height`() {
        val karte = Regex("""\b(Card|AppKarte|OutlinedCard|ElevatedCard)\(""")
        val fixedHeight = Regex("""modifier\s*=\s*Modifier[^\n]*?\.height\(""")
        val violations = mutableListOf<String>()
        var karten = 0
        for (datei in Quellen.unter("ui")) {
            val zeilen = Quellen.withoutComments(datei.readText()).lines()
            for ((nr, zeile) in zeilen.withIndex()) {
                if (!karte.containsMatchIn(zeile)) continue
                karten++
                // Der Modifier der Karte steht in ihren ersten Argumentzeilen.
                val kopf = zeilen.subList(nr, minOf(nr + 6, zeilen.size))
                // Ohne Inhalt (`) {}`) ist es ein Platzhalter: Dessen feste Höhe
                // hält die Liste ruhig, bis die Seite kommt (CatalogScrubberTest).
                if (kopf.any { it.trim() == ") {}" }) continue
                val treffer = kopf.indexOfFirst { fixedHeight.containsMatchIn(it) }
                if (treffer >= 0) violations += "${datei.name}:${nr + treffer + 1}"
            }
        }
        Assert.assertTrue("Keine Karte gefunden — Muster veraltet?", karten >= 10)
        Assert.assertTrue("Feste Kartenhöhe statt heightIn(min = …): $violations", violations.isEmpty())
    }

    /**
     * Dasselbe für Knöpfe, Chips und anklickbare Flächen: Sie tragen Text.
     *
     * Gegenprobe (am 28.10.2026 gemessen, kotlinc): die Periodenchips in
     * PortfolioChart.kt wieder mit `Modifier.height(28.dp)` → rot mit
     * „PortfolioChart.kt …“.
     */
    @Test
    fun `buttons and chips have no fixed height`() {
        val button = Regex("""\b(Button|OutlinedButton|TextButton|FilledTonalButton|FilterChip|AuswahlChip|AssistChip|InputChip|Surface)\(""")
        val fixedHeight = Regex("""modifier\s*=\s*Modifier\.height\(""")
        val violations = mutableListOf<String>()
        var buttons = 0
        for (datei in Quellen.unter("ui")) {
            val zeilen = Quellen.withoutComments(datei.readText()).lines()
            for ((nr, zeile) in zeilen.withIndex()) {
                if (!button.containsMatchIn(zeile)) continue
                buttons++
                val kopf = zeilen.subList(nr, minOf(nr + 6, zeilen.size))
                val treffer = kopf.indexOfFirst { fixedHeight.containsMatchIn(it) }
                if (treffer >= 0) violations += "${datei.name}:${nr + treffer + 1}"
            }
        }
        Assert.assertTrue("Keine Knöpfe gefunden — Muster veraltet?", buttons >= 20)
        Assert.assertTrue("Feste Höhe an Knopf oder Chip statt heightIn(min = …): $violations", violations.isEmpty())
    }

    /**
     * Das Kachelbild sitzt oben bündig in der Karte: Seine oberen Ecken haben den Radius
     * der Leiste, unten keinen. Gegenprobe kachelbild-eigener-radius (12.dp; kotlinc) → rot hier.
     */
    @Test
    fun `image corner and card shape share the radius`() {
        val groesse = Size(112f, 208f)
        val dichte = Density(2.75f)
        fun px(corner: CornerSize) = corner.toPx(groesse, dichte)
        Assert.assertEquals(px(Formen.leiste.topStart), px(Formen.kachelBildEcken.topStart), 0f)
        Assert.assertEquals(px(Formen.leiste.topEnd), px(Formen.kachelBildEcken.topEnd), 0f)
        Assert.assertTrue("Die Leiste ist rund", px(Formen.leiste.topStart) > 0f)
        Assert.assertEquals("unten hat das Bild keine Ecke", 0f, px(Formen.kachelBildEcken.bottomStart), 0f)
    }
}
