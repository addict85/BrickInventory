package ch.brickinventoryapp

import ch.brickinventoryapp.ui.theme.DunkelTokens
import ch.brickinventoryapp.ui.theme.argb
import ch.brickinventoryapp.ui.theme.dunkelToken
import ch.brickinventoryapp.ui.theme.dunkleRollen
import ch.brickinventoryapp.ui.theme.dunkleSteinDekor
import ch.brickinventoryapp.ui.theme.hatDunkleFassung
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die dunkle Fassung je Design kommt aus denselben Tokens wie im Web
 * (shared/design-tokens.json, Abschnitt `dunkel`), und ihre Rollen sind lesbar.
 *
 * Dass DunkelTokens.kt die Quelle wiedergibt, prüft seit dem 30.10. der
 * Generator selbst: Web-App/test/design-abschrift.test.js vergleicht die Datei
 * mit baueKotlinDunkel() („erzeugt = Quelle“). Der Wert-für-Wert-Vergleich, der
 * hier für die Abschrift stand, ist damit entfallen.
 *
 * Gegenproben (29.10.2026, gemessen gegen ui/theme/DunkelTokens.kt):
 *   B  den Eintrag "farbfaecher" umbenannt → rot „jedes Design der Quelle hat
 *      seine dunkle Fassung“
 *   C  in dunkelToken() `erbt` nicht aufgelöst → rot „hochglanz erbt die Farben
 *      von noppe“ und die drei Prüfungen der Rollen (b600 fehlt, es greift classic)
 *   D  outline auf s400 statt s500 → rot „Rahmen heben sich mit 3 zu 1 ab“
 *   E  onPrimary auf "txt" statt "auf-primaer" → rot „Text auf Flächen ist lesbar“
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh gegen DunkleRollen.kt):
 *   F  dunkleSteinDekor() mit den hellen Noppen (#6d94b8) → rot „die
 *      Stein-Dekoration wird im Dunkeln dunkel“
 *   G  die Schrift auf der Schieferkachel weiss gelassen → rot ebenda
 */
class DunkelTokensTest {

    private val quelle = JSONObject(File("../../shared/design-tokens.json").readText()).getJSONObject("dunkel")

    @Test
    fun `jedes Design der Quelle hat seine dunkle Fassung`() {
        val namen = quelle.getJSONObject("designs").keys().asSequence().toSet()
        assertEquals(namen, DunkelTokens.designs.keys)
        for (n in namen) assertTrue(n, hatDunkleFassung(n))
        assertFalse("Werkbank ist schon dunkel", hatDunkleFassung("werkbank"))
    }

    @Test
    fun `hochglanz erbt die Farben von noppe`() {
        for (t in listOf("b600", "b700", "chart-new", "ink")) {
            assertEquals(t, dunkelToken("noppe", t), dunkelToken("hochglanz", t))
        }
        assertEquals("Flächen kommen aus der Basis", DunkelTokens.basis["bg"], dunkelToken("brick", "bg"))
    }

    private fun k(a: Long, b: Long) = Kontrast.verhaeltnis(a.toInt(), b.toInt())

    @Test
    fun `Text auf Flaechen ist lesbar`() {
        val fehler = mutableListOf<String>()
        for (d in DunkelTokens.designs.keys) {
            val r = dunkleRollen(d)
            val paare = mapOf(
                "onSurface/surface" to (r.onSurface to r.surface),
                "onSurfaceVariant/surface" to (r.onSurfaceVariant to r.surface),
                "onPrimary/primary" to (r.onPrimary to r.primary),
                "onPrimaryContainer/primaryContainer" to (r.onPrimaryContainer to r.primaryContainer),
                "onSecondaryContainer/secondaryContainer" to (r.onSecondaryContainer to r.secondaryContainer),
                "erfolg/surface" to (r.erfolg to r.surface),
                "error/surface" to (r.error to r.surface),
            )
            for ((name, p) in paare) if (k(p.first, p.second) < 4.5) fehler += "$d.$name %.2f".format(k(p.first, p.second))
        }
        assertTrue("Unter 4,5:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `Rahmen heben sich mit 3 zu 1 ab`() {
        val fehler = mutableListOf<String>()
        for (d in DunkelTokens.designs.keys) {
            val r = dunkleRollen(d)
            // surfaceContainerHighest liegt zehn Prozent Richtung onSurface; s300 ist heller.
            for ((name, flaeche) in mapOf("surface" to r.surface, "background" to r.background,
                    "surfaceVariant" to r.surfaceVariant, "s300" to argb(DunkelTokens.basis.getValue("s300")))) {
                if (k(r.outline, flaeche) < Kontrast.RAHMEN) fehler += "$d.outline/$name"
            }
            if (k(r.outlineVariant, r.surface) >= k(r.outline, r.surface)) fehler += "$d.outlineVariant"
        }
        assertTrue("Zu schwache Rahmen: $fehler", fehler.isEmpty())
    }

    @Test
    fun `die Flaechen sind dunkel und die Schrift hell`() {
        for (d in DunkelTokens.designs.keys) {
            val r = dunkleRollen(d)
            assertTrue(d, Kontrast.luminanz(r.background.toInt()) < 0.05)
            assertTrue(d, Kontrast.luminanz(r.onSurface.toInt()) > 0.7)
        }
    }

    /**
     * Wie [data-dunkel] im Web: Noppen und Schieferkachel aus der dunklen Fassung.
     * Fest eingesetzt blieben die hellen Töne von „brick“ auch im Dunkeln stehen.
     */
    @Test
    fun `die Stein-Dekoration wird im Dunkeln dunkel`() {
        val hell = JSONObject(File("../../shared/design-tokens.json").readText())
            .getJSONObject("designs").getJSONObject("brick")
        val d = dunkleSteinDekor()
        assertEquals(argb(dunkelToken("brick", "b400")!!), d.noppen)
        assertTrue("Die Noppen sind im Dunkeln dunkler als hell",
            Kontrast.luminanz(d.noppen.toInt()) < Kontrast.luminanz(argb(hell.getString("b400")).toInt()))
        val karte = dunkleRollen("brick").surface
        assertTrue("Die Noppen heben sich von der Karte ab", k(d.noppen, karte) >= Kontrast.RAHMEN)
        assertTrue("Schrift auf der Schieferkachel lesbar", k(d.aufSchiefer, d.schiefer) >= 4.5)
    }
}
