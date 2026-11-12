package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.app.ui.components.ZertifikatDialog
import ch.brickinventoryapp.app.ui.components.schliessbar
import ch.brickinventoryapp.sicherheit.Abschrift
import org.junit.Assert.assertFalse
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.sicherheit.ZertifikatUngeklaert
import ch.brickinventoryapp.sicherheit.fingerabdruckLesbar
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

/**
 * Was der Zertifikatsdialog zeigt: Wo abgetippt wird, steht der abzutippende Teil
 * nicht auf dem Bildschirm (nur der Anfang); beim Erstkontakt über eine öffentliche
 * CA der ganze Fingerabdruck zum Vergleichen.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) im Dialog wieder `fingerabdruckLesbar(frage.fingerabdruck)` statt des
 *       Anfangs → rot „wer abtippt, sieht den abzutippenden Teil nicht“
 *       (gegenproben/zertifikat-zeigt-alles.patch)
 *   (b) `abschreiben` nur für GEAENDERT → rot „ueber eine Nutzer-CA …“
 *       (gegenproben/nutzerca-ein-tipp.patch)
 *   (c) ZertifikatDialog ohne den Zweig für CODE_ABWEICHUNG → rot „weicht der
 *       Server vom Code ab …“ (gegenproben/code-abweichung-im-dialog.patch)
 *   (d) das Feld wieder mit dem ganzen Satz als Etikett, ohne Erklärung darunter →
 *       rot „das Feld traegt ein kurzes Etikett …“ (gegenproben/zertifikat-satz-als-etikett.patch)
 *   (e) Fingerabdruckfeld ohne abschriftInPaaren() (keine Doppelpunkte) → rot „die Abschrift
 *       bekommt beim Tippen Doppelpunkte …“ (gegenproben/abschrift-ohne-paare.patch)
 *   (f) in abschriftFehler() ZU_KURZ wie PASST_NICHT → rot „zu kurz und falsch …“
 *       (gegenproben/abschrift-zu-kurz-wie-falsch.patch)
 *   (g) schliessbar() mit `dismissOnClickOutside = true` → rot „daneben tippen schliesst
 *       den Dialog nie …“ (gegenproben/zertifikat-daneben-verworfen.patch)
 */
@RunWith(RobolectricTestRunner::class)
class ZertifikatDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { (it * 7 + 3).toByte() })
    private val hex = fingerabdruckLesbar(fp)

    private fun zeige(art: ZertifikatUngeklaert.Art, erwartet: String? = null, onVertrauen: (String?) -> Boolean = { false }) {
        val frage = ZertifikatUngeklaert("nas:8443", fp, art, erwartet)
        compose.setContent {
            BrickInventoryManagerTheme {
                ZertifikatDialog(frage, nutzerCaAn = false, onVertrauen = onVertrauen, onNutzerCa = {}, onAbbrechen = {})
            }
        }
        compose.waitForIdle()
    }

    private fun feld() = compose.onNode(hasSetTextAction())

    private fun getippt(): String =
        feld().fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /**
     * Die Webapp zeigt `AB:CD:…`. Wer „24 Zeichen“ samt Doppelpunkten abschrieb, hatte nur 16
     * Hex. Das Feld setzt die Doppelpunkte selbst und zählt nur, was zählt.
     */
    @Test
    fun `die Abschrift bekommt beim Tippen Doppelpunkte und einen Zaehler der Zeichen`() {
        zeige(ZertifikatUngeklaert.Art.UNBEKANNTE_CA)
        assertEquals("Der Zähler steht vor dem Tippen da", 1, gezeigt("0/24"))
        feld().performTextInput("3fa2b")
        assertEquals("3F:A2:B", getippt())
        assertEquals(1, gezeigt("5/24"))
        feld().performTextInput("c")
        assertEquals("Weitergetippt wird am Ende, nicht vor dem letzten Zeichen", "3F:A2:BC", getippt())
        assertEquals(1, gezeigt("6/24"))
    }

    @Test
    fun `zu kurz und falsch abgeschrieben sind verschiedene Fehler`() {
        val ohnePunkte = hex.replace(":", "")
        zeige(ZertifikatUngeklaert.Art.UNBEKANNTE_CA) { Abschrift.bestaetigt(it, fp) }
        val knopf = compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen))
        feld().performTextInput(ohnePunkte.takeLast(16))
        knopf.performClick()
        assertEquals("16 Zeichen sind zu kurz, nicht falsch", 1,
            gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 16, 24)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput("0".repeat(24))
        knopf.performClick()
        assertEquals(1, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput(ohnePunkte.takeLast(24))
        knopf.performClick()
        assertEquals("Angenommen: kein Fehler mehr", 0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 24, 24)))
    }

    /** Ein Tipp daneben verwarf das halb Abgetippte; Zurück gilt nur, solange nichts getippt ist. */
    @Test
    fun `daneben tippen schliesst den Dialog nie, zurueck nur ohne Eingabe`() {
        assertFalse(schliessbar("").dismissOnClickOutside)
        assertTrue(schliessbar("").dismissOnBackPress)
        assertFalse(schliessbar("3F:A2").dismissOnClickOutside)
        assertFalse(schliessbar("3F:A2").dismissOnBackPress)
    }

    private fun gezeigt(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().size

    @Test
    fun `wer abtippt, sieht den abzutippenden Teil nicht`() {
        zeige(ZertifikatUngeklaert.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals("Die letzten 24 Zeichen stehen da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Der Anfang fehlt", 1, gezeigt(hex.take(11)))
    }

    @Test
    fun `ohne bekannte CA steht nur der Anfang da`() {
        zeige(ZertifikatUngeklaert.Art.UNBEKANNTE_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        assertEquals(1, gezeigt(hex.take(11)))
    }

    @Test
    fun `beim Erstkontakt ueber eine oeffentliche CA steht der ganze Fingerabdruck da`() {
        zeige(ZertifikatUngeklaert.Art.ERSTKONTAKT)
        assertEquals(1, gezeigt(hex))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `weicht der Server vom Code ab, gibt es nichts zu bestaetigen`() {
        val laut = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        zeige(ZertifikatUngeklaert.Art.CODE_ABWEICHUNG, erwartet = laut)
        compose.onNodeWithText(ctx.getString(R.string.zert_titel_code_abweichung)).assertExists()
        assertEquals("Der Wert des Servers steht ganz da", 1, gezeigt(hex))
        assertEquals("Der Wert des Codes steht ganz da", 1, gezeigt(fingerabdruckLesbar(laut)))
        assertEquals("Kein Knopf zum Vertrauen", 0, gezeigt(ctx.getString(R.string.zert_vertrauen)))
        assertEquals("Kein Feld zum Abtippen", 0,
            compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
    }

    @Test
    fun `das Feld traegt ein kurzes Etikett, die Anleitung steht darunter`() {
        zeige(ZertifikatUngeklaert.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texte = feld.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("Kein kurzes Etikett: $texte", ctx.getString(R.string.zert_eingabe_etikett) in texte)
        assertTrue("Die Anleitung fehlt: $texte", ctx.getString(R.string.zert_geaendert_eingabe) in texte)
    }

    @Test
    fun `ueber eine Nutzer-CA genuegt kein Tipp, die Eingabe ist blind`() {
        zeige(ZertifikatUngeklaert.Art.NUTZER_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput(hex.takeLast(35))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }
}
