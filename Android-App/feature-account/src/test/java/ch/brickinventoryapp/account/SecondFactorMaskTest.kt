package ch.brickinventoryapp.account

import android.app.Activity
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.core.content.IntentCompat
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.screens.CODES_FILE
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.StepGuard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.util.Locale

/**
 * The admins' mandatory-factor mask, run through: setup only with
 * password, the key in groups of four, only digits go out as the code, the
 * emergency codes before Next (and only with the "secured" checkbox checked), the step indicator,
 * the announced hint without an authenticator app, sign-out at every step, and at
 * 200% font size no text wraps mid-word.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   factor-screen-without-password      setup also without a password → red "ohne Passwort richtet …"
 *   factor-screen-key-in-one-piece  key without groups → red "waehrend der Einrichtung …"
 *   factor-screen-without-codes         the codes never shown → red "nach der Bestaetigung …"
 *   factor-screen-next-without-checkbox  "Next" free even without the checkbox → red "nach der Bestaetigung …"
 *   factor-screen-step-fixed       step indicator always on step 1 → red "die Schrittanzeige …"
 *   factor-screen-hint-silent      hint without app without ansagen() → red "ohne Authenticator-App …"
 *   factor-screen-logout-only-at-start  sign-out only in the first step → red "Abmelden bleibt …"
 *   factor-screen-huge-title        heading in a narrow column → red "bei 200 Prozent …"
 *   codes-share-via-clipboard      "Share" puts the codes on the clipboard → red "die Notfallcodes lassen sich teilen …"
 *   codes-copyable-again         a button copies the codes to the clipboard → red "kein Knopf der Codes …"
 *   key-copy-before-33     key copyable from API 30 → red "der Schluessel ist erst ab API 33 …"
 *   codes-save-as-share       "Save as file" shares again (ACTION_SEND) → red "die Notfallcodes lassen sich als Datei speichern …" (not measured locally)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SecondFactorMaskTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val before = Locale.getDefault()
    private val condition = mutableStateOf(SecondFactorUiState())
    private val setUp = mutableListOf<String>()
    private val confirmed = mutableListOf<String>()
    private var nextTapped = 0
    private var loggedOut = 0

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun text(id: Int) = compose.activity.getString(id)

    /** The Android level the mask picks by; Robolectric itself runs against API 35. */
    private val level = mutableStateOf(Build.VERSION.SDK_INT)

    private fun show(font: Float = 1f) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(
                    LocalDensity provides Density(d.density, font),
                    LocalSdkLevel provides level.value,
                    // The device lock counts as confirmed; the mask is what's checked.
                    LocalStepGuard provides StepGuard { _, dann -> dann() },
                ) {
                    SecondFactorRequiredMask(
                        condition = condition.value,
                        onSetUp = { setUp += it },
                        onConfirm = { confirmed += it },
                        onNext = { nextTapped++ },
                        onLogout = { loggedOut++ },
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun button(id: Int): SemanticsNodeInteraction = compose.onNode(hasText(text(id)) and hasClickAction())

    private fun guarded() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private val key = "JBSWY3DPEHPK3PXP"
    private val setup = SecondFactorUiState(active = false, secret = key,
        otpauth = "otpauth://totp/Brick:marco?secret=$key")
    private val codes = SecondFactorUiState(active = true, codes = listOf("aaaa-bbbb", "cccc-dddd"))

    @Test
    fun `without a password the form sets up nothing, with a password it does`() {
        condition.value = SecondFactorUiState(active = false)
        show()
        button(R.string.setup_continue).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        button(R.string.setup_continue).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("geheim-123"), setUp)
    }

    @Test
    fun `during the setup the key stands in groups and only digits go out`() {
        condition.value = setup
        show()
        compose.onNodeWithText("JBSW Y3DP EHPK 3PXP").assertExists()
        assertTrue("the key stands in plain text: no screenshot", guarded())
        button(R.string.zf_confirm).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("12 34 56")
        button(R.string.zf_confirm).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("123456"), confirmed)
    }

    @Test
    fun `after confirmation the emergency codes are shown, continuing only with the saved check`() {
        condition.value = codes
        show()
        // The code text reads character by character (readAloudAs); its text isn't in the tree.
        compose.onNodeWithContentDescription("a a a a - b b b b, c c c c - d d d d").assertExists()
        assertTrue("the codes stand in plain text: no screenshot", guarded())
        button(R.string.zf_required_next).assertIsNotEnabled()
        button(R.string.zf_codes_saved).performScrollTo().performClick()
        compose.waitForIdle()
        button(R.string.zf_required_next).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(1, nextTapped)
    }

    /**
     * The codes go, on tap, to an app of choice (password manager) — via the system's
     * picker, not via the clipboard, which would keep them in its history.
     */
    @Test
    fun `the emergency codes can be shared without filling the clipboard`() {
        condition.value = codes
        show()
        assertEquals("nothing is shared before the tap", null,
            Shadows.shadowOf(compose.activity).peekNextStartedActivity())
        button(R.string.zf_share).performScrollTo().performClick()
        compose.waitForIdle()
        val selection = Shadows.shadowOf(compose.activity).nextStartedActivity
        assertEquals(Intent.ACTION_CHOOSER, selection?.action)
        val send = IntentCompat.getParcelableExtra(selection!!, Intent.EXTRA_INTENT,
            Intent::class.java)
        assertEquals(Intent.ACTION_SEND, send?.action)
        assertEquals("aaaa-bbbb\ncccc-dddd", send?.getStringExtra(Intent.EXTRA_TEXT))
        val store = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("sharing puts nothing on the clipboard", !store.hasPrimaryClip())
    }

    /** Prefers a file at a location of choice: when sharing, the target app would read along. */
    @Test
    fun `the emergency codes can be saved as a file, that checks saved`() {
        condition.value = codes
        show()
        button(R.string.zf_required_next).assertIsNotEnabled()
        button(R.string.zf_codes_save).performScrollTo().performClick()
        compose.waitForIdle()
        val started = Shadows.shadowOf(compose.activity).nextStartedActivityForResult
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, started?.intent?.action)
        assertEquals("text/plain", started?.intent?.type)
        assertEquals(CODES_FILE, started?.intent?.getStringExtra(Intent.EXTRA_TITLE))

        val target = Uri.parse("content://dokumente.test/codes.txt")
        val file = ByteArrayOutputStream()
        Shadows.shadowOf(compose.activity.contentResolver).registerOutputStream(target, file)
        Shadows.shadowOf(compose.activity).receiveResult(started!!.intent, Activity.RESULT_OK, Intent().setData(target))
        compose.waitForIdle()
        assertEquals("aaaa-bbbb\ncccc-dddd\n", file.toString(Charsets.UTF_8.name()))
        button(R.string.zf_required_next).assertIsEnabled()
        val store = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("saving puts nothing on the clipboard", !store.hasPrimaryClip())
    }

    /** Every button of the code step tapped (sign-out excepted): the clipboard stays empty. */
    @Test
    fun `no button of the codes puts them into the clipboard`() {
        condition.value = codes
        show()
        val buttons = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .mapNotNull { it.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            .filter { it != text(R.string.settings_logout) }
        assertTrue("the code step has no buttons: $buttons", buttons.size >= 2)
        for (k in buttons) {
            compose.onNode(hasText(k) and hasClickAction()).performScrollTo().performClick()
            compose.waitForIdle()
        }
        val store = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("a button put the codes on the clipboard: $buttons", !store.hasPrimaryClip())
    }

    @Test
    fun `the key is copyable only from API 33, and then marked as confidential`() {
        assertTrue("below API 33 the system shows copied secrets", !secretCopyable(32))
        assertTrue(secretCopyable(33))
        condition.value = setup
        level.value = 32
        show()
        assertEquals("below API 33 no button to copy", 0,
            compose.onAllNodes(hasText(text(R.string.zf_copy_key))).fetchSemanticsNodes().size)
        level.value = 33
        compose.waitForIdle()
        button(R.string.zf_copy_key).performScrollTo().performClick()
        compose.waitForIdle()
        val clip = compose.activity.getSystemService(ClipboardManager::class.java).primaryClip
        assertEquals(key, clip?.getItemAt(0)?.text?.toString())
        assertEquals(true, clip?.description?.extras?.getBoolean("android.content.extra.IS_SENSITIVE"))
    }

    @Test
    fun `the step indicator names step and name`() {
        val je = listOf(SecondFactorUiState(active = false) to (1 to R.string.zf_step_password),
            setup to (2 to R.string.zf_step_app_title), codes to (3 to R.string.zf_step_codes))
        show()
        for ((step, expected) in je) {
            condition.value = step
            compose.waitForIdle()
            val (number, name) = expected
            compose.onNodeWithText(compose.activity.resources.getQuantityString(R.plurals.zf_step, 3, number, 3, text(name)))
                .assertExists()
        }
    }

    @Test
    fun `without an authenticator app the hint is announced`() {
        condition.value = setup
        show()
        button(R.string.zf_open_app).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNode(hasText(text(R.string.zf_no_app)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion),
            useUnmergedTree = true).assertExists()
    }

    @Test
    fun `sign-out stays possible in every step`() {
        val steps = listOf(SecondFactorUiState(active = false), setup, codes, SecondFactorUiState(active = true))
        show()
        steps.forEachIndexed { i, step ->
            condition.value = step
            compose.waitForIdle()
            button(R.string.settings_logout).performScrollTo().performClick()
            compose.waitForIdle()
            assertEquals("step $i", i + 1, loggedOut)
        }
    }

    @Test
    fun `at 200 percent font no text wraps in the middle of a word`() {
        val je = listOf(
            SecondFactorUiState(active = false) to listOf(R.string.zf_required_title, R.string.zf_required_short,
                R.string.common_learn_more, R.string.zf_required_password, R.string.setup_continue, R.string.settings_logout),
            setup to listOf(R.string.zf_required_title, R.string.zf_step_app, R.string.zf_open_app,
                R.string.zf_copy_key, R.string.zf_confirm),
            codes to listOf(R.string.zf_required_codes_title, R.string.zf_codes_hint,
                R.string.zf_share, R.string.zf_codes_saved, R.string.zf_required_next),
        )
        show(font = 2f)
        val broken = mutableListOf<String>()
        for ((step, texts) in je) {
            condition.value = step
            compose.waitForIdle()
            for (t in texts.map(::text)) if (breaksInWord(layout(t))) broken += t
        }
        assertTrue("wrapped in the middle of a word: $broken", broken.isEmpty())
    }

    /** The layout of the text node with exactly [text] (not a field that carries it). */
    private fun layout(text: String): TextLayoutResult {
        val node = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        val outcome = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        return outcome.single()
    }

    /** A line ends between two letters — neither at whitespace nor after a hyphen. */
    private fun breaksInWord(t: TextLayoutResult): Boolean {
        val s = t.layoutInput.text.text
        return (0 until t.lineCount - 1).any { row ->
            val end = t.getLineEnd(row)
            end in 1 until s.length && !s[end - 1].isWhitespace() && s[end - 1] != '-' && !s[end].isWhitespace()
        }
    }
}
