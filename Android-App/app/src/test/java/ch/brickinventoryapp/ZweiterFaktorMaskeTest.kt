package ch.brickinventoryapp

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
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.Schrittschutz
import ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske
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
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ZweiterFaktorMaskeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val vorher = java.util.Locale.getDefault()
    private val zustand = mutableStateOf(ZweiterFaktorUiState())
    private val eingerichtet = mutableListOf<String>()
    private val bestaetigt = mutableListOf<String>()
    private var weiterGetippt = 0
    private var abgemeldet = 0

    init { java.util.Locale.setDefault(java.util.Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = java.util.Locale.setDefault(vorher)

    private fun text(id: Int) = compose.activity.getString(id)

    private fun zeige(schrift: Float = 1f) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                val d = LocalDensity.current
                CompositionLocalProvider(
                    LocalDensity provides Density(d.density, schrift),
                    // Die Gerätesperre gilt als bestätigt; geprüft wird die Maske.
                    LocalSchrittschutz provides Schrittschutz { _, dann -> dann() },
                ) {
                    ZweiterFaktorPflichtMaske(
                        zustand = zustand.value,
                        onEinrichten = { eingerichtet += it },
                        onBestaetigen = { bestaetigt += it },
                        onWeiter = { weiterGetippt++ },
                        onAbmelden = { abgemeldet++ },
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun knopf(id: Int): SemanticsNodeInteraction = compose.onNode(hasText(text(id)) and hasClickAction())

    private fun geschuetzt() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private val schluessel = "JBSWY3DPEHPK3PXP"
    private val einrichtung = ZweiterFaktorUiState(aktiv = false, geheimnis = schluessel,
        otpauth = "otpauth://totp/Brick:marco?secret=$schluessel")
    private val codes = ZweiterFaktorUiState(aktiv = true, codes = listOf("aaaa-bbbb", "cccc-dddd"))

    @Test
    fun `ohne Passwort richtet die Maske nichts ein, mit Passwort schon`() {
        zustand.value = ZweiterFaktorUiState(aktiv = false)
        zeige()
        knopf(R.string.zf_setup).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        knopf(R.string.zf_setup).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("geheim-123"), eingerichtet)
    }

    @Test
    fun `waehrend der Einrichtung steht der Schluessel in Gruppen da und nur Ziffern gehen hinaus`() {
        zustand.value = einrichtung
        zeige()
        compose.onNodeWithText("JBSW Y3DP EHPK 3PXP").assertExists()
        assertTrue("Der Schlüssel steht im Klartext da: kein Bildschirmfoto", geschuetzt())
        knopf(R.string.zf_confirm).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("12 34 56")
        knopf(R.string.zf_confirm).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("123456"), bestaetigt)
    }

    @Test
    fun `nach der Bestaetigung stehen die Notfallcodes da, weiter erst mit dem Haken gesichert`() {
        zustand.value = codes
        zeige()
        compose.onNodeWithText("aaaa-bbbb\ncccc-dddd").assertExists()
        assertTrue("Die Codes stehen im Klartext da: kein Bildschirmfoto", geschuetzt())
        knopf(R.string.zf_pflicht_weiter).assertIsNotEnabled()
        knopf(R.string.zf_codes_gesichert).performScrollTo().performClick()
        compose.waitForIdle()
        knopf(R.string.zf_pflicht_weiter).assertIsEnabled().performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(1, weiterGetippt)
    }

    @Test
    fun `die Schrittanzeige nennt Schritt und Namen`() {
        val je = listOf(ZweiterFaktorUiState(aktiv = false) to (1 to R.string.zf_schritt_passwort),
            einrichtung to (2 to R.string.zf_schritt_app), codes to (3 to R.string.zf_schritt_codes))
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
    fun `ohne Authenticator-App wird der Hinweis angesagt`() {
        zustand.value = einrichtung
        zeige()
        knopf(R.string.zf_open_app).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNode(hasText(text(R.string.zf_no_app)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion),
            useUnmergedTree = true).assertExists()
    }

    @Test
    fun `Abmelden bleibt in jedem Schritt moeglich`() {
        val schritte = listOf(ZweiterFaktorUiState(aktiv = false), einrichtung, codes, ZweiterFaktorUiState(aktiv = true))
        zeige()
        schritte.forEachIndexed { i, schritt ->
            zustand.value = schritt
            compose.waitForIdle()
            knopf(R.string.settings_logout).performScrollTo().performClick()
            compose.waitForIdle()
            assertEquals("Schritt $i", i + 1, abgemeldet)
        }
    }

    @Test
    fun `bei 200 Prozent Schrift bricht kein Text mitten im Wort um`() {
        val je = listOf(
            ZweiterFaktorUiState(aktiv = false) to listOf(R.string.zf_pflicht_titel, R.string.zf_pflicht_text,
                R.string.zf_pflicht_passwort, R.string.zf_setup, R.string.settings_logout),
            einrichtung to listOf(R.string.zf_pflicht_titel, R.string.zf_step_app, R.string.zf_open_app,
                R.string.zf_copy_key, R.string.zf_confirm),
            codes to listOf(R.string.zf_pflicht_codes_titel, R.string.zf_codes_hint, R.string.zf_copy,
                R.string.zf_codes_gesichert, R.string.zf_pflicht_weiter),
        )
        zeige(schrift = 2f)
        val gebrochen = mutableListOf<String>()
        for ((schritt, texte) in je) {
            zustand.value = schritt
            compose.waitForIdle()
            for (t in texte.map(::text)) if (brichtImWort(layout(t))) gebrochen += t
        }
        assertTrue("Mitten im Wort umgebrochen: $gebrochen", gebrochen.isEmpty())
    }

    /** Das Layout des Textknotens mit genau [text] (nicht eines Feldes, das ihn trägt). */
    private fun layout(text: String): TextLayoutResult {
        val knoten = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        val ergebnis = mutableListOf<TextLayoutResult>()
        knoten.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    /** Eine Zeile endet zwischen zwei Buchstaben — weder an einem Leerraum noch nach einem Bindestrich. */
    private fun brichtImWort(t: TextLayoutResult): Boolean {
        val s = t.layoutInput.text.text
        return (0 until t.lineCount - 1).any { zeile ->
            val ende = t.getLineEnd(zeile)
            ende in 1 until s.length && !s[ende - 1].isWhitespace() && s[ende - 1] != '-' && !s[ende].isWhitespace()
        }
    }
}
