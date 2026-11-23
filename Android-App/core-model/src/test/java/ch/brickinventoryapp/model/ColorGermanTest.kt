package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.ColorGerman
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Color names in German as in the web app: „Trans-Clear“ was called
 * „Trans-Clear“ in the app, „Trans-Klar“ in the web app.
 *
 * Counter-checks:
 *   A  in uebersetze() the prefixes not attached → red “compound
 *      colors …” (Dunkel Bläulich Grau)
 *   B  "tan" removed from the vocabulary → red “the same vocabulary …”
 */
class ColorGermanTest {

    @Test
    fun `compound colors are written together as in German`() {
        assertEquals("Dunkelbläulichgrau", ColorGerman.translate("Dark Bluish Gray"))
        assertEquals("Trans-Klar", ColorGerman.translate("Trans-Clear"))
        assertEquals("Rot", ColorGerman.translate("Red"))
        assertEquals("Perlgold", ColorGerman.translate("Pearl Gold"))
        assertEquals("Trans-Neongrün", ColorGerman.translate("Trans-Neon Green"))
    }

    @Test
    fun `unknown words stay`() {
        assertEquals("Vintage Blau", ColorGerman.translate("Vintage Blue"))
        assertEquals("", ColorGerman.translate(""))
    }

    /** Both UIs shall name the same color the same way. */
    @Test
    fun `the same vocabulary as in the web app`() {
        val js = File("../../Web-App/public/i18n.js").readText()
        val block = js.substring(js.indexOf("const COLOR_WORDS_DE"), js.indexOf("};", js.indexOf("const COLOR_WORDS_DE")))
        // Keys with or without quotes: the formatter leaves them out where JavaScript does not need them.
        val web = Regex("""(?:'([^']+)'|([A-Za-z_]\w*))\s*:\s*'([^']*)'""").findAll(block)
            .associate { (it.groupValues[1].ifEmpty { it.groupValues[2] }) to it.groupValues[3] }
        assert(web.size > 10) { "Only ${web.size} words found in the block COLOR_WORDS_DE – pattern outdated?" }
        assertEquals(web, ColorGerman.words)
        val pre = js.substring(js.indexOf("const COLOR_PREFIX_DE"), js.indexOf("]);", js.indexOf("const COLOR_PREFIX_DE")))
        assertEquals(Regex("""'([^']+)'""").findAll(pre).map { it.groupValues[1] }.toSet(), ColorGerman.prefixes)
    }
}
