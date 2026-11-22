package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.closable
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * Counter-checks (Robolectric, measurable only in CI; job `counter-checks`):
 *   (a) in the dialog again `fingerprintReadable(question.fingerprint)` instead of the
 *       beginning → red “whoever types it sees no part that is to be typed”
 *       (counter-checks/zertifikat-zeigt-alles.patch)
 *   (b) `writeOff` only for GEAENDERT → red “via a user CA …”
 *       (counter-checks/nutzerca-ein-tipp.patch)
 *   (c) CertificateDialog without the branch for CODE_MISMATCH → red “if the
 *       server deviates from the code …” (counter-checks/code-abweichung-im-dialog.patch)
 *   (d) the field again with the whole sentence as label, without explanation below →
 *       red “the field carries a short label …” (counter-checks/zertifikat-satz-als-etikett.patch)
 *   (e) fingerprint field without pairTranscriptIn() (no colons) → red “the transcript
 *       gets colons …” (counter-checks/abschrift-ohne-paare.patch)
 *   (f) in transcriptError() TO_SHORT like FITS_NOT → red “too short and wrongly …”
 *       (counter-checks/abschrift-zu-kurz-wie-falsch.patch)
 *   (g) schliessbar() with `dismissOnClickOutside = true` → red “tapping outside never closes
 *       the dialog …” (counter-checks/zertifikat-daneben-verworfen.patch)
 *   (h) `writeOff` also for KEY_NEW → red “with CT requirement a new server key is
 *       shown in full …” (counter-checks/schluessel-neu-abtippen.patch)
 *   (i) the button „stattdessen abtippen“ removed → red “on first contact it can be
 *       typed instead …” (counter-checks/erstkontakt-ohne-abtippen.patch)
 *   (j) `writeOff` for KEY_NEW always off again → red “without CT requirement a
 *       new server key is typed …” (counter-checks/schluessel-neu-dialog-ohne-feld.patch)
 *   (k) `writeOff` on first contact again only on request → red “without CT requirement it is
 *       typed on first contact …” (counter-checks/erstkontakt-dialog-ein-tipp.patch)
 */
@RunWith(RobolectricTestRunner::class)
class CertificateDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { (it * 7 + 3).toByte() })
    private val hex = fingerprintReadable(fp)

    private fun show(
        kind: CertificateUnresolved.Kind,
        expected: String? = null,
        ct: Boolean = false,
        trustOn: (String?) -> Boolean = { false },
    ) {
        val question = CertificateUnresolved("nas:8443", fp, kind, expected, ctForced = ct)
        compose.setContent {
            BrickInventoryManagerTheme {
                CertificateDialog(question, userCaEnabled = false, trustOn = trustOn, onUserCa = {}, onCancel = {})
            }
        }
        compose.waitForIdle()
    }

    private fun field() = compose.onNode(hasSetTextAction())

    private fun typed(): String =
        field().fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /**
     * The web app shows `AB:CD:…`. Whoever copied „24 Zeichen“ including colons had only 16
     * hex. The field sets the colons itself and counts only what counts.
     */
    @Test
    fun `the transcript gets colons and a character counter while typing`() {
        show(CertificateUnresolved.Kind.UNKNOWN_CA)
        assertEquals("Der Zähler steht vor dem Tippen da", 1, shown("0/24"))
        field().performTextInput("3fa2b")
        assertEquals("3F:A2:B", typed())
        assertEquals(1, shown("5/24"))
        field().performTextInput("c")
        assertEquals("Weitergetippt wird am Ende, nicht vor dem letzten Zeichen", "3F:A2:BC", typed())
        assertEquals(1, shown("6/24"))
    }

    @Test
    fun `too short and wrongly transcribed are different errors`() {
        val withoutPoints = hex.replace(":", "")
        show(CertificateUnresolved.Kind.UNKNOWN_CA) { Transcript.confirmed(it, fp) }
        val button = compose.onNodeWithText(ctx.getString(R.string.cert_trust))
        field().performTextInput(withoutPoints.takeLast(16))
        button.performClick()
        assertEquals("16 Zeichen sind zu kurz, nicht falsch", 1,
            shown(ctx.getString(R.string.cert_input_too_short, 16, 24)))
        assertEquals(0, shown(ctx.getString(R.string.cert_input_wrong)))

        field().performTextClearance()
        field().performTextInput("0".repeat(24))
        button.performClick()
        assertEquals(1, shown(ctx.getString(R.string.cert_input_wrong)))

        field().performTextClearance()
        field().performTextInput(withoutPoints.takeLast(24))
        button.performClick()
        assertEquals("Angenommen: kein Fehler mehr", 0, shown(ctx.getString(R.string.cert_input_wrong)))
        assertEquals(0, shown(ctx.getString(R.string.cert_input_too_short, 24, 24)))
    }

    /** A tap outside discarded the half-typed input; Back applies only as long as nothing is typed. */
    @Test
    fun `tapping outside never closes the dialog, back only without input`() {
        assertFalse(closable("").dismissOnClickOutside)
        assertTrue(closable("").dismissOnBackPress)
        assertFalse(closable("3F:A2").dismissOnClickOutside)
        assertFalse(closable("3F:A2").dismissOnBackPress)
    }

    private fun shown(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().size

    @Test
    fun `whoever types it sees no part that is to be typed`() {
        show(CertificateUnresolved.Kind.CHANGED, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals("Die letzten 24 Zeichen stehen da", 0, shown(hex.takeLast(35)))
        assertEquals("Der Anfang fehlt", 1, shown(hex.take(11)))
    }

    @Test
    fun `without a known CA only the beginning is shown`() {
        show(CertificateUnresolved.Kind.UNKNOWN_CA)
        assertEquals(0, shown(hex.takeLast(35)))
        assertEquals(1, shown(hex.take(11)))
    }

    @Test
    fun `on first contact via a public CA the whole fingerprint is shown`() {
        show(CertificateUnresolved.Kind.FIRST_CONTACT, ct = true)
        assertEquals(1, shown(hex))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsEnabled()
    }

    @Test
    fun `if the server deviates from the code there is nothing to confirm`() {
        val aloud = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        show(CertificateUnresolved.Kind.CODE_MISMATCH, expected = aloud)
        compose.onNodeWithText(ctx.getString(R.string.cert_title_code_mismatch)).assertExists()
        assertEquals("Der Wert des Servers steht ganz da", 1, shown(hex))
        assertEquals("Der Wert des Codes steht ganz da", 1, shown(fingerprintReadable(aloud)))
        assertEquals("Kein Knopf zum Vertrauen", 0, shown(ctx.getString(R.string.cert_trust)))
        assertEquals("Kein Feld zum Abtippen", 0,
            compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
    }

    @Test
    fun `the field carries a short label, the instructions are below it`() {
        show(CertificateUnresolved.Kind.CHANGED, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        val field = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = field.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("Kein kurzes Etikett: $texts", ctx.getString(R.string.cert_input_label) in texts)
        assertTrue("Die Anleitung fehlt: $texts", ctx.getString(R.string.cert_changed_input) in texts)
    }

    @Test
    fun `via a user CA a tap is not enough, the input is blind`() {
        show(CertificateUnresolved.Kind.USER_CA)
        assertEquals(0, shown(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput(hex.takeLast(35))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsEnabled()
    }

    @Test
    fun `with CT requirement a new server key is shown in full and applies without typing`() {
        val previous = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        var accepted: String? = "nie"
        show(CertificateUnresolved.Kind.KEY_NEW, expected = previous, ct = true) { accepted = it; true }
        compose.onNodeWithText(ctx.getString(R.string.cert_title_key_new)).assertExists()
        assertEquals("Der neue Schlüssel steht ganz da", 1, shown(hex))
        assertEquals("Der bisherige auch", 1, shown(fingerprintReadable(previous)))
        assertEquals("Kein Feld zum Abtippen", 0, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsEnabled().performClick()
        assertEquals(null, accepted)
    }

    @Test
    fun `without CT requirement a new server key is typed, only the beginning is shown`() {
        var accepted: String? = null
        show(CertificateUnresolved.Kind.KEY_NEW, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") { accepted = it; true }
        assertEquals("Das Abzutippende steht nicht da", 0, shown(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.cert_key_new_input)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsNotEnabled()
        field().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), accepted?.replace(":", ""))
    }

    @Test
    fun `on first contact it can be typed instead, then only the beginning is shown`() {
        var accepted: String? = null
        show(CertificateUnresolved.Kind.FIRST_CONTACT, ct = true) { accepted = it; true }
        compose.onNodeWithText(ctx.getString(R.string.cert_first_contact_type)).performClick()
        compose.waitForIdle()
        assertEquals("Das Abzutippende steht nicht mehr da", 0, shown(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsNotEnabled()
        field().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), accepted?.replace(":", ""))
    }

    /** Android 11–15: without CT a misissued chain would get through with a tap. */
    @Test
    fun `without CT requirement it is typed on first contact, a tap is not enough`() {
        var accepted: String? = null
        show(CertificateUnresolved.Kind.FIRST_CONTACT) { accepted = it; true }
        compose.onNodeWithText(ctx.getString(R.string.cert_text_first_contact_type, "nas")).assertExists()
        assertEquals("Das Abzutippende steht nicht da", 0, shown(hex.takeLast(35)))
        assertEquals("Abtippen ist keine Wahl", 0, shown(ctx.getString(R.string.cert_first_contact_type)))
        compose.onNodeWithText(ctx.getString(R.string.cert_first_contact_input)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsNotEnabled()
        field().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), accepted?.replace(":", ""))
    }
}
