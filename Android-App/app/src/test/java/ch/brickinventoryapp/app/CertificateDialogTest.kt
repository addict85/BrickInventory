package ch.brickinventoryapp.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.CodeScan
import ch.brickinventoryapp.app.ui.components.closable
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
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
import org.robolectric.RuntimeEnvironment
import java.util.Base64

/**
 * What the certificate dialog shows: where typing is required, the part to be typed
 * is not on the screen (only the beginning). Every question except a code deviation,
 * first contact and a new key under a public CA included, is typed.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `counter-checks`):
 *   (a) in the dialog again `fingerprintReadable(question.fingerprint)` instead of the
 *       beginning → red “whoever types it sees no part that is to be typed”
 *       (counter-checks/certificate-shows-everything.patch)
 *   (b) the trust button active without input for USER_CA → red “via a user CA …”
 *       (counter-checks/user-ca-one-tap.patch)
 *   (c) CertificateDialog without the branch for CODE_MISMATCH → red “if the
 *       server deviates from the code …” (counter-checks/code-mismatch-in-dialog.patch)
 *   (d) the field again with the whole sentence as label, without explanation below →
 *       red “the field carries a short label …” (counter-checks/certificate-sentence-as-label.patch)
 *   (e) fingerprint field without pairTranscriptIn() (no colons) → red “the transcript
 *       gets colons …” (counter-checks/transcript-without-pairs.patch)
 *   (f) in transcriptError() TO_SHORT like FITS_NOT → red “too short and wrongly …”
 *       (counter-checks/transcript-too-short-as-wrong.patch)
 *   (g) schliessbar() with `dismissOnClickOutside = true` → red “tapping outside never closes
 *       the dialog …” (counter-checks/certificate-mismatch-discarded.patch)
 *   (j) no field for KEY_NEW → red “a new server key is typed …”
 *       (counter-checks/key-new-dialog-without-field.patch)
 *   (k) the trust button active without input on first contact → red “on first contact it is typed …”
 *       (counter-checks/first-contact-dialog-one-tap.patch)
 *   (l) the scan offered under a public CA too (`codeScan.takeIf { true }`) → red “under a public
 *       CA there is nothing to scan” (counter-checks/certificate-scan-public.patch)
 *   (m) scanError() silent for FITS_NOT → red “a scanned code that does not fit …”
 *       (counter-checks/certificate-scan-mismatch-silent.patch)
 *   (n) the manual comparison open from the start despite a QR route → red “with a QR route the
 *       scan comes first …” (counter-checks/certificate-manual-open-with-qr.patch)
 *   (o) a third sentence in a German explanation → red “every explanation has at most two
 *       sentences …” (counter-checks/certificate-text-three-sentences.patch)
 *   (p) a failed scan leaves the manual comparison folded → red “a scanned code that does not fit …”
 *       (counter-checks/certificate-scan-error-folded.patch)
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
        codeScan: CodeScan? = null,
        trustOn: (String?) -> Boolean = { false },
    ) {
        val question = CertificateUnresolved("nas:8443", fp, kind, expected)
        compose.setContent {
            BrickInventoryManagerTheme {
                CertificateDialog(question, userCaEnabled = false, trustOn = trustOn, onUserCa = {}, onCancel = {},
                    codeScan = codeScan)
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
        assertEquals("the counter is shown before typing", 1, shown("0/24"))
        field().performTextInput("3fa2b")
        assertEquals("3F:A2:B", typed())
        assertEquals(1, shown("5/24"))
        field().performTextInput("c")
        assertEquals("typing continues at the end, not before the last character", "3F:A2:BC", typed())
        assertEquals(1, shown("6/24"))
    }

    @Test
    fun `too short and wrongly transcribed are different errors`() {
        val withoutPoints = hex.replace(":", "")
        show(CertificateUnresolved.Kind.UNKNOWN_CA) { Transcript.confirmed(it, fp) }
        val button = compose.onNodeWithText(ctx.getString(R.string.cert_trust))
        field().performTextInput(withoutPoints.takeLast(16))
        button.performClick()
        assertEquals("16 characters are too short, not wrong", 1,
            shown(ctx.getString(R.string.cert_input_too_short, 16, 24)))
        assertEquals(0, shown(ctx.getString(R.string.cert_input_wrong)))

        field().performTextClearance()
        field().performTextInput("0".repeat(24))
        button.performClick()
        assertEquals(1, shown(ctx.getString(R.string.cert_input_wrong)))

        field().performTextClearance()
        field().performTextInput(withoutPoints.takeLast(24))
        button.performClick()
        assertEquals("accepted: no error any more", 0, shown(ctx.getString(R.string.cert_input_wrong)))
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
        assertEquals("the last 24 characters are shown", 0, shown(hex.takeLast(35)))
        assertEquals("the beginning is missing", 1, shown(hex.take(11)))
    }

    @Test
    fun `without a known CA only the beginning is shown`() {
        show(CertificateUnresolved.Kind.UNKNOWN_CA)
        assertEquals(0, shown(hex.takeLast(35)))
        assertEquals(1, shown(hex.take(11)))
    }

    @Test
    fun `if the server deviates from the code there is nothing to confirm`() {
        val aloud = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        show(CertificateUnresolved.Kind.CODE_MISMATCH, expected = aloud)
        compose.onNodeWithText(ctx.getString(R.string.cert_title_code_mismatch)).assertExists()
        assertEquals("the server's value is shown in full", 1, shown(hex))
        assertEquals("the code's value is shown in full", 1, shown(fingerprintReadable(aloud)))
        assertEquals("no button to trust", 0, shown(ctx.getString(R.string.cert_trust)))
        assertEquals("no field to type it in", 0,
            compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
    }

    @Test
    fun `the field carries a short label, the instructions are below it`() {
        show(CertificateUnresolved.Kind.CHANGED, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        val field = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = field.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("no short label: $texts", ctx.getString(R.string.cert_input_label) in texts)
        assertTrue("the instructions are missing: $texts", ctx.getString(R.string.cert_changed_input) in texts)
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
    fun `a new server key is typed, only the beginning is shown`() {
        var accepted: String? = null
        show(CertificateUnresolved.Kind.KEY_NEW, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") { accepted = it; true }
        assertEquals("what is to be typed in is not shown", 0, shown(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.cert_key_new_input)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsNotEnabled()
        field().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), accepted?.replace(":", ""))
    }

    /** Instead of the camera a button that delivers [payload]; [answer] stands for the comparison. */
    private fun fakeScan(payload: String, answer: CodeCheck, seen: MutableList<String>) =
        CodeScan(trust = { seen += it; answer }) { onResult, _ ->
            TextButton(onClick = { onResult(payload) }) { Text("fake scan") }
        }

    @Test
    fun `a scanned code that does not fit says so and leaves the comparison by hand`() {
        val seen = mutableListOf<String>()
        show(CertificateUnresolved.Kind.CHANGED, expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            codeScan = fakeScan("brickinventory-cert:v1:spki-sha256:00", CodeCheck.FITS_NOT, seen))
        assertEquals("the button replaces the old hint", 0, shown(ctx.getString(R.string.cert_changed_qr)))
        compose.onNodeWithText(ctx.getString(R.string.cert_scan_qr)).performClick()
        compose.onNodeWithText("fake scan").performClick()
        compose.waitForIdle()
        assertEquals(listOf("brickinventory-cert:v1:spki-sha256:00"), seen)
        assertEquals(1, shown(ctx.getString(R.string.cert_scan_mismatch)))
        assertEquals("the field for typing stays", 1, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithText(ctx.getString(R.string.cert_trust_new)).assertIsNotEnabled()
    }

    /** One main action instead of a screen of text: the scan on top, typing folded below it. */
    @Test
    fun `with a QR route the scan comes first, comparing by hand waits folded below it`() {
        show(CertificateUnresolved.Kind.UNKNOWN_CA,
            codeScan = fakeScan("brickinventory-cert:v1:spki-sha256:00", CodeCheck.MATCHES, mutableListOf()))
        val scan = compose.onNodeWithText(ctx.getString(R.string.cert_scan_qr)).fetchSemanticsNode().boundsInRoot
        val manual = compose.onNodeWithText(ctx.getString(R.string.cert_manual_compare))
        assertTrue("the scan does not stand above the manual comparison", scan.bottom <= manual.fetchSemanticsNode().boundsInRoot.top)
        assertEquals("no field before choosing to compare", 0, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        assertEquals("no trust button without a way to trust", 0, shown(ctx.getString(R.string.cert_trust)))
        manual.performClick()
        compose.waitForIdle()
        assertEquals(1, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsNotEnabled()
        assertEquals("the beginning only", 0, shown(hex.takeLast(35)))
    }

    /** Where to find the fingerprint is said once, below the field; the explanation stays short. */
    @Test
    fun `every explanation has at most two sentences in both languages`() {
        val texts = listOf(R.string.cert_text_first_contact_type, R.string.cert_text_unknown, R.string.cert_text_user_ca,
            R.string.cert_text_changed, R.string.cert_text_key_new)
        for (language in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(language)
            val r = ApplicationProvider.getApplicationContext<Context>()
            for (id in texts) {
                val text = r.getString(id, "nas")
                val sentences = text.trim().split(Regex("""(?<=[.!?])\s+(?=\p{Lu}|%|\d)""")).size
                assertTrue("$language: „$text“ has $sentences sentences", sentences <= 2)
                assertFalse("$language: „$text“ repeats the instructions", '\n' in text)
            }
        }
    }

    @Test
    fun `under a public CA there is nothing to scan`() {
        val seen = mutableListOf<String>()
        show(CertificateUnresolved.Kind.FIRST_CONTACT,
            codeScan = fakeScan("brickinventory-cert:v1:spki-sha256:00", CodeCheck.MATCHES, seen))
        assertEquals(0, shown(ctx.getString(R.string.cert_scan_qr)))
    }

    /** On every API level: a misissued public chain would otherwise get through with a tap. */
    @Test
    fun `on first contact it is typed, a tap is not enough`() {
        var accepted: String? = null
        show(CertificateUnresolved.Kind.FIRST_CONTACT) { accepted = it; true }
        compose.onNodeWithText(ctx.getString(R.string.cert_text_first_contact_type, "nas")).assertExists()
        assertEquals("what is to be typed in is not shown", 0, shown(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.cert_first_contact_input)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsNotEnabled()
        field().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.cert_trust)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), accepted?.replace(":", ""))
    }
}
