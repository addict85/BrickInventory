package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.ui.theme.Design
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.Schrittschutz
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import android.content.ClipboardManager
import android.content.Intent
import androidx.core.content.IntentCompat
import android.app.Activity
import android.net.Uri
import ch.brickinventoryapp.account.ui.screens.CODES_FILE
import java.io.ByteArrayOutputStream
import java.util.Locale
import org.robolectric.Shadows
import android.os.Build

/**
 * Die Maske für den Pflicht-Faktor der Verwalter, ausgeführt: Einrichten erst mit
 * Passwort, der Schlüssel in Vierergruppen, nur Ziffern gehen als Code hinaus, die
 * Notfallcodes vor dem Weiter (und erst mit dem Haken „gesichert“), die Schrittanzeige,
 * der angesagte Hinweis ohne Authenticator-App, Abmelden in jedem Schritt, und bei
 * 200 % Schrift bricht kein Text mitten im Wort um.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   faktormaske-ohne-passwort      Einrichten auch ohne Passwort → rot „ohne Passwort richtet …“
 *   faktormaske-schluessel-am-stueck  Schlüssel ohne Gruppen → rot „waehrend der Einrichtung …“
 *   faktormaske-ohne-codes         die Codes nie gezeigt → rot „nach der Bestaetigung …“
 *   faktormaske-weiter-ohne-haken  „Weiter“ auch ohne Haken frei → rot „nach der Bestaetigung …“
 *   faktormaske-schritt-fest       Schrittanzeige immer bei Schritt 1 → rot „die Schrittanzeige …“
 *   faktormaske-hinweis-stumm      Hinweis ohne App ohne ansagen() → rot „ohne Authenticator-App …“
 *   faktormaske-abmelden-nur-anfangs  Abmelden nur im ersten Schritt → rot „Abmelden bleibt …“
 *   faktormaske-riesentitel        Überschrift in schmaler Spalte → rot „bei 200 Prozent …“
 *   codes-teilen-ueber-ablage      „Teilen“ legt die Codes in die Zwischenablage → rot „die Notfallcodes lassen sich teilen …“
 *   codes-wieder-kopierbar         ein Knopf kopiert die Codes in die Ablage → rot „kein Knopf der Codes …“
 *   schluessel-kopieren-vor-33     Schlüssel kopierbar ab API 30 → rot „der Schluessel ist erst ab API 33 …“
 *   codes-sichern-als-teilen       „Als Datei speichern“ teilt wieder (ACTION_SEND) → rot „die Notfallcodes
 *                                  lassen sich als Datei speichern …“ (nicht lokal gemessen)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SecondFactorMaskTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val vorher = Locale.getDefault()
    private val zustand = mutableStateOf(ZweiterFaktorUiState())
    private val eingerichtet = mutableListOf<String>()
    private val confirmed = mutableListOf<String>()
    private var nextTapped = 0
    private var abgemeldet = 0

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun text(id: Int) = compose.activity.getString(id)

    /** Die Android-Stufe, nach der die Maske wählt; Robolectric selbst läuft gegen API 35. */
    private val stufe = mutableStateOf(Build.VERSION.SDK_INT)

    private fun zeige(schrift: Float = 1f) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(
                    LocalDensity provides Density(d.density, schrift),
                    LocalSdkLevel provides stufe.value,
                    // Die Gerätesperre gilt als bestätigt; geprüft wird die Maske.
                    LocalSchrittschutz provides Schrittschutz { _, dann -> dann() },
                ) {
                    ZweiterFaktorPflichtMaske(
                        zustand = zustand.value,
                        onEinrichten = { eingerichtet += it },
                        onBestaetigen = { confirmed += it },
                        onWeiter = { nextTapped++ },
                        onAbmelden = { abgemeldet++ },
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun button(id: Int): SemanticsNodeInteraction = compose.onNode(hasText(text(id)) and hasClickAction())

    private fun geschuetzt() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private val schluessel = "JBSWY3DPEHPK3PXP"
    private val setup = ZweiterFaktorUiState(aktiv = false, geheimnis = schluessel,
        otpauth = "otpauth://totp/Brick:marco?secret=$schluessel")
    private val codes = ZweiterFaktorUiState(aktiv = true, codes = listOf("aaaa-bbbb", "cccc-dddd"))

    @Test
    fun `without a password the form sets up nothing, with a password it does`() {
        zustand.value = ZweiterFaktorUiState(aktiv = false)
        zeige()
        button(R.string.setup_continue).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        button(R.string.setup_continue).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("geheim-123"), eingerichtet)
    }

    @Test
    fun `during the setup the key stands in groups and only digits go out`() {
        zustand.value = setup
        zeige()
        compose.onNodeWithText("JBSW Y3DP EHPK 3PXP").assertExists()
        assertTrue("Der Schlüssel steht im Klartext da: kein Bildschirmfoto", geschuetzt())
        button(R.string.zf_confirm).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("12 34 56")
        button(R.string.zf_confirm).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("123456"), confirmed)
    }

    @Test
    fun `after confirmation the emergency codes are shown, continuing only with the saved check`() {
        zustand.value = codes
        zeige()
        // Der Codetext liest sich Zeichen für Zeichen (readAloudAs); sein Text steht nicht im Baum.
        compose.onNodeWithContentDescription("a a a a - b b b b, c c c c - d d d d").assertExists()
        assertTrue("Die Codes stehen im Klartext da: kein Bildschirmfoto", geschuetzt())
        button(R.string.zf_pflicht_weiter).assertIsNotEnabled()
        button(R.string.zf_codes_gesichert).performScrollTo().performClick()
        compose.waitForIdle()
        button(R.string.zf_pflicht_weiter).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(1, nextTapped)
    }

    /**
     * Die Codes gehen auf Tipp an eine App der Wahl (Passwortmanager) — über die Auswahl
     * des Systems, nicht über die Zwischenablage, deren Verlauf sie behielte.
     */
    @Test
    fun `the emergency codes can be shared without filling the clipboard`() {
        zustand.value = codes
        zeige()
        assertEquals("Vor dem Tipp wird nichts geteilt", null,
            Shadows.shadowOf(compose.activity).peekNextStartedActivity())
        button(R.string.zf_share).performScrollTo().performClick()
        compose.waitForIdle()
        val selection = Shadows.shadowOf(compose.activity).nextStartedActivity
        assertEquals(Intent.ACTION_CHOOSER, selection?.action)
        val senden = IntentCompat.getParcelableExtra(selection!!, Intent.EXTRA_INTENT,
            Intent::class.java)
        assertEquals(Intent.ACTION_SEND, senden?.action)
        assertEquals("aaaa-bbbb\ncccc-dddd", senden?.getStringExtra(Intent.EXTRA_TEXT))
        val ablage = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("Teilen legt nichts in die Zwischenablage", !ablage.hasPrimaryClip())
    }

    /** Bevorzugt eine Datei am Ort der Wahl: Beim Teilen läse die Ziel-App mit. */
    @Test
    fun `the emergency codes can be saved as a file, that checks saved`() {
        zustand.value = codes
        zeige()
        button(R.string.zf_pflicht_weiter).assertIsNotEnabled()
        button(R.string.zf_codes_speichern).performScrollTo().performClick()
        compose.waitForIdle()
        val gestartet = Shadows.shadowOf(compose.activity).nextStartedActivityForResult
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, gestartet?.intent?.action)
        assertEquals("text/plain", gestartet?.intent?.type)
        assertEquals(CODES_FILE, gestartet?.intent?.getStringExtra(Intent.EXTRA_TITLE))

        val ziel = Uri.parse("content://dokumente.test/codes.txt")
        val datei = ByteArrayOutputStream()
        Shadows.shadowOf(compose.activity.contentResolver).registerOutputStream(ziel, datei)
        Shadows.shadowOf(compose.activity).receiveResult(gestartet!!.intent, Activity.RESULT_OK, Intent().setData(ziel))
        compose.waitForIdle()
        assertEquals("aaaa-bbbb\ncccc-dddd\n", datei.toString(Charsets.UTF_8.name()))
        button(R.string.zf_pflicht_weiter).assertIsEnabled()
        val ablage = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("Speichern legt nichts in die Zwischenablage", !ablage.hasPrimaryClip())
    }

    /** Jeder Knopf des Codeschritts getippt (ausser Abmelden): Die Ablage bleibt leer. */
    @Test
    fun `no button of the codes puts them into the clipboard`() {
        zustand.value = codes
        zeige()
        val buttons = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .mapNotNull { it.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            .filter { it != text(R.string.settings_logout) }
        assertTrue("Der Codeschritt hat keine Knöpfe: $buttons", buttons.size >= 2)
        for (k in buttons) {
            compose.onNode(hasText(k) and hasClickAction()).performScrollTo().performClick()
            compose.waitForIdle()
        }
        val ablage = compose.activity.getSystemService(ClipboardManager::class.java)
        assertTrue("Ein Knopf legte die Codes in die Zwischenablage: $buttons", !ablage.hasPrimaryClip())
    }

    @Test
    fun `the key is copyable only from API 33, and then marked as confidential`() {
        assertTrue("Unter API 33 zeigt das System kopierte Geheimnisse an", !secretCopyable(32))
        assertTrue(secretCopyable(33))
        zustand.value = setup
        stufe.value = 32
        zeige()
        assertEquals("Unter API 33 kein Knopf zum Kopieren", 0,
            compose.onAllNodes(hasText(text(R.string.zf_copy_key))).fetchSemanticsNodes().size)
        stufe.value = 33
        compose.waitForIdle()
        button(R.string.zf_copy_key).performScrollTo().performClick()
        compose.waitForIdle()
        val clip = compose.activity.getSystemService(ClipboardManager::class.java).primaryClip
        assertEquals(schluessel, clip?.getItemAt(0)?.text?.toString())
        assertEquals(true, clip?.description?.extras?.getBoolean("android.content.extra.IS_SENSITIVE"))
    }

    @Test
    fun `the step indicator names step and name`() {
        val je = listOf(ZweiterFaktorUiState(aktiv = false) to (1 to R.string.zf_schritt_passwort),
            setup to (2 to R.string.zf_schritt_app), codes to (3 to R.string.zf_schritt_codes))
        zeige()
        for ((schritt, erwartet) in je) {
            zustand.value = schritt
            compose.waitForIdle()
            val (nummer, name) = erwartet
            compose.onNodeWithText(compose.activity.resources.getQuantityString(R.plurals.zf_schritt, 3, nummer, 3, text(name)))
                .assertExists()
        }
    }

    @Test
    fun `without an authenticator app the hint is announced`() {
        zustand.value = setup
        zeige()
        button(R.string.zf_open_app).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNode(hasText(text(R.string.zf_no_app)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion),
            useUnmergedTree = true).assertExists()
    }

    @Test
    fun `sign-out stays possible in every step`() {
        val schritte = listOf(ZweiterFaktorUiState(aktiv = false), setup, codes, ZweiterFaktorUiState(aktiv = true))
        zeige()
        schritte.forEachIndexed { i, schritt ->
            zustand.value = schritt
            compose.waitForIdle()
            button(R.string.settings_logout).performScrollTo().performClick()
            compose.waitForIdle()
            assertEquals("Schritt $i", i + 1, abgemeldet)
        }
    }

    @Test
    fun `at 200 percent font no text wraps in the middle of a word`() {
        val je = listOf(
            ZweiterFaktorUiState(aktiv = false) to listOf(R.string.zf_pflicht_titel, R.string.zf_pflicht_kurz,
                R.string.common_learn_more, R.string.zf_pflicht_passwort, R.string.setup_continue, R.string.settings_logout),
            setup to listOf(R.string.zf_pflicht_titel, R.string.zf_step_app, R.string.zf_open_app,
                R.string.zf_copy_key, R.string.zf_confirm),
            codes to listOf(R.string.zf_pflicht_codes_titel, R.string.zf_codes_hint,
                R.string.zf_share, R.string.zf_codes_gesichert, R.string.zf_pflicht_weiter),
        )
        zeige(schrift = 2f)
        val gebrochen = mutableListOf<String>()
        for ((schritt, texts) in je) {
            zustand.value = schritt
            compose.waitForIdle()
            for (t in texts.map(::text)) if (brichtInWord(layout(t))) gebrochen += t
        }
        assertTrue("Mitten im Wort umgebrochen: $gebrochen", gebrochen.isEmpty())
    }

    /** Das Layout des Textknotens mit genau [text] (nicht eines Feldes, das ihn trägt). */
    private fun layout(text: String): TextLayoutResult {
        val node = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        val ergebnis = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    /** Eine Zeile endet zwischen zwei Buchstaben — weder an einem Leerraum noch nach einem Bindestrich. */
    private fun brichtInWord(t: TextLayoutResult): Boolean {
        val s = t.layoutInput.text.text
        return (0 until t.lineCount - 1).any { zeile ->
            val ende = t.getLineEnd(zeile)
            ende in 1 until s.length && !s[ende - 1].isWhitespace() && s[ende - 1] != '-' && !s[ende].isWhitespace()
        }
    }
}
