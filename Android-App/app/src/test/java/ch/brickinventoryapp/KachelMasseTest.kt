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

    @Test
    fun `beide Bestandskacheln holen ihre Masse dort`() {
        var nutzer = 0
        for (datei in Quellen.unter("ui")) {
            val src = Quellen.ohneKommentare(datei.readText())
            if (src.contains("Formen.kachelBreite") && src.contains("Formen.kachelHoehe")) nutzer++
        }
        // Selbstbeweis: Ohne Fundstellen sagt die Pruefung oben nichts — sie
        // waere auch dann gruen, wenn es die Kacheln gar nicht mehr gaebe.
        assert(nutzer >= 2) {
            "Nur $nutzer Bildschirm(e) benutzen Formen.kachelBreite/-Hoehe — erwartet " +
                "werden die Teile- und die Minifiguren-Kachel. Umbenannt oder entfernt?"
        }
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
