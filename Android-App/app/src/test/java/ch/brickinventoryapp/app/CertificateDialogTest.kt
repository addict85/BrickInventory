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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.closable
import ch.brickinventoryapp.security.Transcript
import org.junit.Assert.assertFalse
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.fingerprintReadable
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
 * What the certificate dialog shows: where typing is required, the part to be typed
 * is not on the screen (only the beginning); on first contact via a public
 * CA the whole fingerprint for comparison.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `gegenproben`):
 *   (a) in the dialog again `fingerprintReadable(frage.fingerabdruck)` instead of the
 *       beginning → red “whoever types it sees no part that is to be typed”
 *       (gegenproben/zertifikat-zeigt-alles.patch)
 *   (b) `writeOff` only for GEAENDERT → red “via a user CA …”
 *       (gegenproben/nutzerca-ein-tipp.patch)
 *   (c) CertificateDialog without the branch for CODE_ABWEICHUNG → red “if the
 *       server deviates from the code …” (gegenproben/code-abweichung-im-dialog.patch)
 *   (d) the field again with the whole sentence as label, without explanation below →
 *       red “the field carries a short label …” (gegenproben/zertifikat-satz-als-etikett.patch)
 *   (e) fingerprint field without pairTranscriptIn() (no colons) → red “the transcript
 *       gets colons …” (gegenproben/abschrift-ohne-paare.patch)
 *   (f) in transcriptError() TO_SHORT like FITS_NOT → red “too short and wrongly …”
 *       (gegenproben/abschrift-zu-kurz-wie-falsch.patch)
 *   (g) schliessbar() with `dismissOnClickOutside = true` → red “tapping outside never closes
 *       the dialog …” (gegenproben/zertifikat-daneben-verworfen.patch)
 *   (h) `writeOff` also for SCHLUESSEL_NEU → red “with CT requirement a new server key is
 *       shown in full …” (gegenproben/schluessel-neu-abtippen.patch)
 *   (i) the button „stattdessen abtippen“ removed → red “on first contact it can be
 *       typed instead …” (gegenproben/erstkontakt-ohne-abtippen.patch)
 *   (j) `writeOff` for SCHLUESSEL_NEU always off again → red “without CT requirement a
 *       new server key is typed …” (gegenproben/schluessel-neu-dialog-ohne-feld.patch)
 *   (k) `writeOff` on first contact again only on request → red “without CT requirement it is
 *       typed on first contact …” (gegenproben/erstkontakt-dialog-ein-tipp.patch)
 */
@RunWith(RobolectricTestRunner::class)
class CertificateDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { (it * 7 + 3).toByte() })
    private val hex = fingerprintReadable(fp)

    private fun zeige(
        art: CertificateUnresolved.Art,
        erwartet: String? = null,
        ct: Boolean = false,
        trustOn: (String?) -> Boolean = { false },
    ) {
        val frage = CertificateUnresolved("nas:8443", fp, art, erwartet, ctForced = ct)
        compose.setContent {
            BrickInventoryManagerTheme {
                CertificateDialog(frage, userCaAn = false, trustOn = trustOn, onNutzerCa = {}, onAbbrechen = {})
            }
        }
        compose.waitForIdle()
    }

    private fun feld() = compose.onNode(hasSetTextAction())

    private fun getippt(): String =
        feld().fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /**
     * The web app shows `AB:CD:…`. Whoever copied „24 Zeichen“ including colons had only 16
     * hex. The field sets the colons itself and counts only what counts.
     */
    @Test
    fun `the transcript gets colons and a character counter while typing`() {
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA)
        assertEquals("Der Zähler steht vor dem Tippen da", 1, gezeigt("0/24"))
        feld().performTextInput("3fa2b")
        assertEquals("3F:A2:B", getippt())
        assertEquals(1, gezeigt("5/24"))
        feld().performTextInput("c")
        assertEquals("Weitergetippt wird am Ende, nicht vor dem letzten Zeichen", "3F:A2:BC", getippt())
        assertEquals(1, gezeigt("6/24"))
    }

    @Test
    fun `too short and wrongly transcribed are different errors`() {
        val withoutPoints = hex.replace(":", "")
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA) { Transcript.confirmed(it, fp) }
        val button = compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen))
        feld().performTextInput(withoutPoints.takeLast(16))
        button.performClick()
        assertEquals("16 Zeichen sind zu kurz, nicht falsch", 1,
            gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 16, 24)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput("0".repeat(24))
        button.performClick()
        assertEquals(1, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput(withoutPoints.takeLast(24))
        button.performClick()
        assertEquals("Angenommen: kein Fehler mehr", 0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 24, 24)))
    }

    /** A tap outside discarded the half-typed input; Back applies only as long as nothing is typed. */
    @Test
    fun `tapping outside never closes the dialog, back only without input`() {
        assertFalse(closable("").dismissOnClickOutside)
        assertTrue(closable("").dismissOnBackPress)
        assertFalse(closable("3F:A2").dismissOnClickOutside)
        assertFalse(closable("3F:A2").dismissOnBackPress)
    }

    private fun gezeigt(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().size

    @Test
    fun `whoever types it sees no part that is to be typed`() {
        zeige(CertificateUnresolved.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals("Die letzten 24 Zeichen stehen da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Der Anfang fehlt", 1, gezeigt(hex.take(11)))
    }

    @Test
    fun `without a known CA only the beginning is shown`() {
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        assertEquals(1, gezeigt(hex.take(11)))
    }

    @Test
    fun `on first contact via a public CA the whole fingerprint is shown`() {
        zeige(CertificateUnresolved.Art.ERSTKONTAKT, ct = true)
        assertEquals(1, gezeigt(hex))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `if the server deviates from the code there is nothing to confirm`() {
        val laut = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        zeige(CertificateUnresolved.Art.CODE_ABWEICHUNG, erwartet = laut)
        compose.onNodeWithText(ctx.getString(R.string.zert_titel_code_abweichung)).assertExists()
        assertEquals("Der Wert des Servers steht ganz da", 1, gezeigt(hex))
        assertEquals("Der Wert des Codes steht ganz da", 1, gezeigt(fingerprintReadable(laut)))
        assertEquals("Kein Knopf zum Vertrauen", 0, gezeigt(ctx.getString(R.string.zert_vertrauen)))
        assertEquals("Kein Feld zum Abtippen", 0,
            compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
    }

    @Test
    fun `the field carries a short label, the instructions are below it`() {
        zeige(CertificateUnresolved.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = feld.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("Kein kurzes Etikett: $texts", ctx.getString(R.string.zert_eingabe_etikett) in texts)
        assertTrue("Die Anleitung fehlt: $texts", ctx.getString(R.string.zert_geaendert_eingabe) in texts)
    }

    @Test
    fun `via a user CA a tap is not enough, the input is blind`() {
        zeige(CertificateUnresolved.Art.NUTZER_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput(hex.takeLast(35))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `with CT requirement a new server key is shown in full and applies without typing`() {
        val bisher = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        var angenommen: String? = "nie"
        zeige(CertificateUnresolved.Art.SCHLUESSEL_NEU, erwartet = bisher, ct = true) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_titel_schluessel_neu)).assertExists()
        assertEquals("Der neue Schlüssel steht ganz da", 1, gezeigt(hex))
        assertEquals("Der bisherige auch", 1, gezeigt(fingerprintReadable(bisher)))
        assertEquals("Kein Feld zum Abtippen", 0, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsEnabled().performClick()
        assertEquals(null, angenommen)
    }

    @Test
    fun `without CT requirement a new server key is typed, only the beginning is shown`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.SCHLUESSEL_NEU, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") { angenommen = it; true }
        assertEquals("Das Abzutippende steht nicht da", 0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_schluessel_neu_eingabe)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }

    @Test
    fun `on first contact it can be typed instead, then only the beginning is shown`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.ERSTKONTAKT, ct = true) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_erstkontakt_abtippen)).performClick()
        compose.waitForIdle()
        assertEquals("Das Abzutippende steht nicht mehr da", 0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }

    /** Android 11–15: without CT a misissued chain would get through with a tap. */
    @Test
    fun `without CT requirement it is typed on first contact, a tap is not enough`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.ERSTKONTAKT) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_text_erstkontakt_abtippen, "nas")).assertExists()
        assertEquals("Das Abzutippende steht nicht da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Abtippen ist keine Wahl", 0, gezeigt(ctx.getString(R.string.zert_erstkontakt_abtippen)))
        compose.onNodeWithText(ctx.getString(R.string.zert_erstkontakt_eingabe)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }
}
