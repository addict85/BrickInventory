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
class KachelMasseTest {

    @Test
    fun `die Kachelmasse stehen nur in Formen`() {
        val zahlen = listOf("width(112.dp)", "height(178.dp)", "topStart = 14.dp")
        val verstoesse = mutableListOf<String>()
        for (datei in Quellen.unter("ui")) {
            if (datei.name == "Formen.kt") continue   // dort gehoeren sie hin
            val src = Quellen.ohneKommentare(datei.readText())
            for ((nr, zeile) in src.lines().withIndex()) {
                for (z in zahlen) if (zeile.contains(z)) {
                    verstoesse += "${datei.name}:${nr + 1}  $z"
                }
            }
        }
        assert(verstoesse.isEmpty()) {
            "Diese Stellen schreiben die Kachelmasse als Zahl:\n  " +
                verstoesse.joinToString("\n  ") +
                "\nSie gehoeren nach Formen (kachelBreite/kachelHoehe/kachelBildEcken). " +
                "Zwei Zahlen fuer dasselbe Raster koennen auseinanderlaufen, und das " +
                "faellt erst am Geraet auf."
        }
    }

    /**
     */
    @Test
    fun `die gemeinsame Kachel holt ihre Masse dort`() {
        val nutzer = Quellen.unter("ui").filter { datei ->
            val src = Quellen.ohneKommentare(datei.readText())
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
    fun `Karten haben keine feste Hoehe`() {
        val karte = Regex("""\b(Card|AppKarte|OutlinedCard|ElevatedCard)\(""")
        val festeHoehe = Regex("""modifier\s*=\s*Modifier[^\n]*?\.height\(""")
        val verstoesse = mutableListOf<String>()
        var karten = 0
        for (datei in Quellen.unter("ui")) {
            val zeilen = Quellen.ohneKommentare(datei.readText()).lines()
            for ((nr, zeile) in zeilen.withIndex()) {
                if (!karte.containsMatchIn(zeile)) continue
                karten++
                // Der Modifier der Karte steht in ihren ersten Argumentzeilen.
                val kopf = zeilen.subList(nr, minOf(nr + 6, zeilen.size))
                // Ohne Inhalt (`) {}`) ist es ein Platzhalter: Dessen feste Höhe
                // hält die Liste ruhig, bis die Seite kommt (CatalogScrubberTest).
                if (kopf.any { it.trim() == ") {}" }) continue
                val treffer = kopf.indexOfFirst { festeHoehe.containsMatchIn(it) }
                if (treffer >= 0) verstoesse += "${datei.name}:${nr + treffer + 1}"
            }
        }
        Assert.assertTrue("Keine Karte gefunden — Muster veraltet?", karten >= 10)
        Assert.assertTrue("Feste Kartenhöhe statt heightIn(min = …): $verstoesse", verstoesse.isEmpty())
    }

    /**
     * Dasselbe für Knöpfe, Chips und anklickbare Flächen: Sie tragen Text.
     *
     * Gegenprobe (am 28.10.2026 gemessen, kotlinc): die Periodenchips in
     * PortfolioChart.kt wieder mit `Modifier.height(28.dp)` → rot mit
     * „PortfolioChart.kt …“.
     */
    @Test
    fun `Knoepfe und Chips haben keine feste Hoehe`() {
        val knopf = Regex("""\b(Button|OutlinedButton|TextButton|FilledTonalButton|FilterChip|AuswahlChip|AssistChip|InputChip|Surface)\(""")
        val festeHoehe = Regex("""modifier\s*=\s*Modifier\.height\(""")
        val verstoesse = mutableListOf<String>()
        var knoepfe = 0
        for (datei in Quellen.unter("ui")) {
            val zeilen = Quellen.ohneKommentare(datei.readText()).lines()
            for ((nr, zeile) in zeilen.withIndex()) {
                if (!knopf.containsMatchIn(zeile)) continue
                knoepfe++
                val kopf = zeilen.subList(nr, minOf(nr + 6, zeilen.size))
                val treffer = kopf.indexOfFirst { festeHoehe.containsMatchIn(it) }
                if (treffer >= 0) verstoesse += "${datei.name}:${nr + treffer + 1}"
            }
        }
        Assert.assertTrue("Keine Knöpfe gefunden — Muster veraltet?", knoepfe >= 20)
        Assert.assertTrue("Feste Höhe an Knopf oder Chip statt heightIn(min = …): $verstoesse", verstoesse.isEmpty())
    }

    /**
     * Das Kachelbild sitzt oben bündig in der Karte: Seine oberen Ecken haben den Radius
     * der Leiste, unten keinen. Gegenprobe kachelbild-eigener-radius (12.dp; kotlinc) → rot hier.
     */
    @Test
    fun `Bildecke und Kartenform teilen sich den Radius`() {
        val groesse = Size(112f, 208f)
        val dichte = Density(2.75f)
        fun px(ecke: CornerSize) = ecke.toPx(groesse, dichte)
        Assert.assertEquals(px(Formen.leiste.topStart), px(Formen.kachelBildEcken.topStart), 0f)
        Assert.assertEquals(px(Formen.leiste.topEnd), px(Formen.kachelBildEcken.topEnd), 0f)
        Assert.assertTrue("Die Leiste ist rund", px(Formen.leiste.topStart) > 0f)
        Assert.assertEquals("unten hat das Bild keine Ecke", 0f, px(Formen.kachelBildEcken.bottomStart), 0f)
    }
}
