package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.FarbeDeutsch
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Farbnamen auf Deutsch wie in der Webapp: „Trans-Clear“ hiess in der App
 * „Trans-Clear“, in der Webapp „Trans-Klar“.
 *
 * Gegenproben:
 *   A  in uebersetze() die Vorsilben nicht angehängt → rot „zusammengesetzte
 *      Farben …“ (Dunkel Bläulich Grau)
 *   B  im Wortschatz "tan" entfernt → rot „derselbe Wortschatz …“
 */
class FarbeDeutschTest {

    @Test
    fun `zusammengesetzte Farben werden wie im Deutschen zusammengeschrieben`() {
        assertEquals("Dunkelbläulichgrau", FarbeDeutsch.uebersetze("Dark Bluish Gray"))
        assertEquals("Trans-Klar", FarbeDeutsch.uebersetze("Trans-Clear"))
        assertEquals("Rot", FarbeDeutsch.uebersetze("Red"))
        assertEquals("Perlgold", FarbeDeutsch.uebersetze("Pearl Gold"))
        assertEquals("Trans-Neongrün", FarbeDeutsch.uebersetze("Trans-Neon Green"))
    }

    @Test
    fun `unbekannte Woerter bleiben stehen`() {
        assertEquals("Vintage Blau", FarbeDeutsch.uebersetze("Vintage Blue"))
        assertEquals("", FarbeDeutsch.uebersetze(""))
    }

    /** Beide Oberflächen sollen dieselbe Farbe gleich nennen. */
    @Test
    fun `derselbe Wortschatz wie in der Webapp`() {
        val js = File("../../Web-App/public/i18n.js").readText()
        val block = js.substring(js.indexOf("const COLOR_WORDS_DE"), js.indexOf("};", js.indexOf("const COLOR_WORDS_DE")))
        // Schlüssel mit oder ohne Anführung: Der Formatierer lässt sie weg, wo JavaScript sie nicht braucht.
        val web = Regex("""(?:'([^']+)'|([A-Za-z_]\w*))\s*:\s*'([^']*)'""").findAll(block)
            .associate { (it.groupValues[1].ifEmpty { it.groupValues[2] }) to it.groupValues[3] }
        assert(web.size > 10) { "Im Block COLOR_WORDS_DE nur ${web.size} Wörter gefunden – Muster veraltet?" }
        assertEquals(web, FarbeDeutsch.woerter)
        val pre = js.substring(js.indexOf("const COLOR_PREFIX_DE"), js.indexOf("]);", js.indexOf("const COLOR_PREFIX_DE")))
        assertEquals(Regex("""'([^']+)'""").findAll(pre).map { it.groupValues[1] }.toSet(), FarbeDeutsch.vorsilben)
    }
}
