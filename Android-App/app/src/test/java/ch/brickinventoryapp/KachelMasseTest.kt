package ch.brickinventoryapp

import org.junit.Test

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
     * ── Nachtrag 138: aus zwei Kacheln wurde eine ───────────────────────────
     *
     * Hier stand `nutzer >= 2` mit der Begruendung „erwartet werden die Teile-
     * und die Minifiguren-Kachel". Das war richtig, solange es zwei gab. Seit
     * beide ueber `ManuelleKachel` laufen, traegt genau EINE Datei die
     * Geometrie — und der Lauf wurde rot, obwohl das Zusammenlegen genau das
     * Ziel dieses Tests weiterfuehrt.
     *
     * Die Untergrenze ist deshalb keine Zahl mehr, sondern eine Aussage: Die
     * Masse stehen genau einmal, und zwar in der gemeinsamen Kachel. Ein
     * Selbstbeweis bleibt es trotzdem — findet der Dateilauf nichts, ist
     * `nutzer` null und der Test rot.
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
     * `Modifier.height(272.dp)` → rot mit „GalleryScreen.kt …“.
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
        org.junit.Assert.assertTrue("Keine Karte gefunden — Muster veraltet?", karten >= 10)
        org.junit.Assert.assertTrue("Feste Kartenhöhe statt heightIn(min = …): $verstoesse", verstoesse.isEmpty())
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
        val knopf = Regex("""\b(Button|OutlinedButton|TextButton|FilledTonalButton|FilterChip|AssistChip|InputChip|Surface)\(""")
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
        org.junit.Assert.assertTrue("Keine Knöpfe gefunden — Muster veraltet?", knoepfe >= 20)
        org.junit.Assert.assertTrue("Feste Höhe an Knopf oder Chip statt heightIn(min = …): $verstoesse", verstoesse.isEmpty())
    }

    @Test
    fun `Bildecke und Kartenform teilen sich den Radius`() {
        // Nicht der Wortlaut, sondern die Ableitung: Beide muessen aus
        // DEMSELBEN Wert gebaut sein. Steht in einer der beiden wieder eine
        // eigene Zahl, koennen sie auseinanderlaufen.
        val formen = Quellen.ohneKommentare(Quellen.lies("ui/theme/Formen.kt"))
        val radius = Regex("""private val leisteRadius = (\d+)\.dp""").find(formen)
        assert(radius != null) { "leisteRadius gibt es nicht mehr — Formen.kt anpassen." }
        for (name in listOf("leiste", "kachelBildEcken")) {
            val zeile = formen.lines().firstOrNull { it.trimStart().startsWith("val $name ") }
            assert(zeile != null && zeile.contains("leisteRadius")) {
                "Formen.$name baut nicht mehr auf leisteRadius auf: ${zeile ?: "(Zeile weg)"}. " +
                    "Das Kachelbild sitzt oben buendig in der Karte — verschiedene Radien " +
                    "lassen es ueberstehen oder einen Spalt."
            }
        }
    }
}
