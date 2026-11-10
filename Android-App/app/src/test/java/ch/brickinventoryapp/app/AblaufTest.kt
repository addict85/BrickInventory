package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.ressourcen.R
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import ch.brickinventoryapp.model.data.model.Gutschein
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.zustand.ui.AnmeldeFormular
import ch.brickinventoryapp.finanzen.ui.GutscheinBestaetigung
import ch.brickinventoryapp.finanzen.ui.GutscheinSchritt
import ch.brickinventoryapp.finanzen.ui.GutscheinUiState
import ch.brickinventoryapp.sammlung.ui.screens.AddSetDialog
import ch.brickinventoryapp.finanzen.ui.screens.GutscheineCard
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.Schrittschutz
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher

/**
 * Die Kernabläufe als Oberflächentest auf der JVM (Robolectric): anmelden, Set
 * erfassen, Menge ändern, Gutschein ansehen. Jede Aktion läuft durch die
 * Barrierefreiheitsprüfung (ATF): Ein Knopf ohne Beschriftung, ein zu kleines
 * Ziel oder zu wenig Kontrast lässt den Test scheitern.
 *
 * Gegenproben (a) und (c) misst der CI-Job `gegenproben` (Android-App/
 * gegenproben/ablauf-*.patch, er verlangt Rot); (b) und (d) sind noch ungemessen:
 *   (a) im Anmeldeknopf `onLogin(password, username, …)` vertauscht → rot
 *       „anmelden reicht Name und Passwort weiter“
 *   (b) der Plus-Knopf ohne Beschreibung → ATF rot in „die Menge aendern …“
 *   (c) AddSetDialog übergibt die Anzahl fest als 1 → rot „ein Set erfassen …“
 *   (d) Gutschein-PIN immer sichtbar → rot „ein Gutschein zeigt den PIN …“
 *   (e) in GutscheineCard das Aufdecken ohne Schrittschutz (`onPinSchalten(g.id)`
 *       direkt) → rot „ohne Bestaetigung der Geraetesperre bleibt der PIN verdeckt“
 *       (gegenproben/gutschein-pin-ohne-geraetesperre.patch)
 *   (f) die Nummer ohne Schrittschutz kopiert → rot „ohne Geraetesperre wird auch die
 *       Nummer nicht kopiert“ (gegenproben/gutschein-nummer-ohne-geraetesperre.patch)
 *   (g) in PasswortRueckfrage das Codefeld nie gezeigt → rot „die Rueckfrage zeigt das
 *       Codefeld erst auf Verlangen“ (gegenproben/gutschein-rueckfrage-ohne-code.patch)
 *   (h) im Set-Detail der Papierkorb immer mit Rückfrage → rot „ein Set loescht mit
 *       Rueckgaengig sofort …“ (gegenproben/set-loeschen-doppelt-gesichert.patch)
 *   (i) Hinzufügen ohne Nummer markiert das Feld nicht → rot „ein Set ohne Nummer sagt …“
 *       (gegenproben/erfassen-ohne-grund.patch)
 */
@RunWith(RobolectricTestRunner::class)
// NATIVE wie bei den Bildschirmfotos: Die Kontrastprüfung des ATF liest ein
// Bildschirmfoto, und im LEGACY-Grafikmodus von Robolectric gibt es keins.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AblaufTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Before
    fun auf() = compose.enableAccessibilityChecks()

    private var welt: Beispiele.Welt? = null

    @After
    fun zu() { welt?.close() }

    private fun zeige(inhalt: @androidx.compose.runtime.Composable () -> Unit) =
        compose.setContent { BrickInventoryManagerTheme { Surface { inhalt() } } }

    @Test
    fun `anmelden reicht Name und Passwort weiter`() {
        var gesendet: Triple<String, String, String?>? = null
        zeige {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { n, p, c -> gesendet = Triple(n, p, c) },
                onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        compose.onNodeWithText(ctx.getString(R.string.login_username)).performTextInput("marco")
        compose.onNodeWithText(ctx.getString(R.string.login_password)).performTextInput("geheim")
        // Wie ein Mensch: erst hinrollen, dann tippen. Der Knopf liegt auf einem
        // kleinen Bildschirm unter dem Rand.
        compose.onNode(hasText(ctx.getString(R.string.login_button)) and hasClickAction())
            .performScrollTo().performClick()
        assertEquals(Triple("marco", "geheim", null), gesendet)
    }

    @Test
    fun `ein Set erfassen nimmt Nummer und Anzahl`() {
        var erfasst: Pair<String, Int>? = null
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst = it.setNumber to it.menge }) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("75192")
        compose.onNodeWithText(ctx.getString(R.string.common_quantity)).performTextReplacement("3")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        assertEquals("75192" to 3, erfasst)
    }

    /** Hinzufügen ohne Nummer erfasst nichts, sagt aber am Feld, was fehlt (statt grau ohne Grund). */
    @Test
    fun `ein Set ohne Nummer sagt beim Tippen auf Hinzufuegen, was fehlt`() {
        var erfasst = 0
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst++ }, sofortFokus = false) }
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Ohne Nummer wird nichts erfasst", 0, erfasst)
        compose.onNodeWithText(ctx.getString(R.string.erfassen_nummer_fehlt), useUnmergedTree = true).assertIsDisplayed()
    }

    /**
     * Eine Nummer, die keine Setnummer ist ("--"), wird nicht erfasst und am Feld erklärt.
     * Gegenprobe: in nummerFehler() den Zweig `!NumericInput.istSetnummer(nummer)` entfernt
     * → erfasst steht auf 1 und der Hinweis fehlt, beide Prüfungen rot.
     */
    @Test
    fun `ein Set mit unsinniger Nummer sagt beim Hinzufuegen, was erwartet wird`() {
        var erfasst = 0
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst++ }, sofortFokus = false) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("--")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Eine unsinnige Nummer wird nicht erfasst", 0, erfasst)
        compose.onNodeWithText(ctx.getString(R.string.erfassen_nummer_ungueltig), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `die Menge aendern schickt einen Schritt an den Server`() {
        val w = Beispiele.Welt().also { welt = it }
        val vm = w.setDetail()
        w.pfade.antworten["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Millennium Falcon","quantity":2}}"""
        zeige {
            SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        // Die Menge steht unter Wert-Kacheln und Marktpreis (M2); auf dem kleinen
        // Robolectric-Bildschirm (320 × 470 dp) ist sie erst nach dem Rollen da.
        val plus = androidx.compose.ui.test.hasContentDescription(ctx.getString(R.string.cd_qty_increase))
        compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction() and
            SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange))
            .performScrollToNode(plus)
        compose.onNode(plus).performClick()
        compose.waitUntil(10_000) { w.pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty() }
        assertTrue(w.pfade.koerper.any { it.contains("\"quantity_delta\":1") })
    }

    /** Eine Sicherung genügt: mit „Rückgängig“ darunter keine Rückfrage, ohne sie schon. */
    @Test
    fun `ein Set loescht mit Rueckgaengig sofort, ohne Rueckgaengig erst nach Rueckfrage`() {
        val w = Beispiele.Welt().also { welt = it }
        val vm = w.setDetail()
        var rueckgaengig by mutableStateOf(true)
        val geloescht = mutableListOf<String>()
        zeige {
            SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = { geloescht += it },
                rueckgaengigMoeglich = rueckgaengig)
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        val name = vm.setDetailState.value.setDetail?.name ?: Beispiele.SET
        val papierkorb = compose.onNodeWithContentDescription(ctx.getString(R.string.cd_set_delete, name))
        papierkorb.performClick()
        compose.waitForIdle()
        assertEquals("Mit Rückgängig sofort vorgemerkt", listOf(Beispiele.SET), geloescht)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertDoesNotExist()

        rueckgaengig = false
        compose.waitForIdle()
        papierkorb.performClick()
        compose.waitForIdle()
        assertEquals("Ohne Rückgängig erst nach der Rückfrage", 1, geloescht.size)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertExists()
    }

    /** Der Zustand der Gutscheinkarte; die Tests der Rückfrage setzen ihn um. */
    private var zustand by mutableStateOf(GutscheinUiState(gutscheine = listOf(
        Gutschein(id = 7, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = Waehrung("CHF")).alsAnsicht())))

    /** Ein Gutschein mit PIN 4711; [schutz] steht für die Gerätesperre. */
    private fun zeigeGutschein(schutz: Schrittschutz, kopiert: MutableList<String> = mutableListOf()) {
        zeige {
            CompositionLocalProvider(LocalSchrittschutz provides schutz) {
                GutscheineCard(
                    zustand = zustand, onFeld = { _, _, _, _ -> },
                    onPinSchalten = { id -> zustand = zustand.copy(pinSichtbar = zustand.pinSichtbar + id) },
                    onBearbeiten = {}, onAbbrechen = {}, onSpeichern = {}, onLoeschen = {}, onPdfOeffnen = {},
                    onKopieren = { id, _ -> kopiert += id.toString() }, onGuthaben = {}, onExportieren = {}, onGuthabenAlle = {},
                    onGuthabenAbbrechen = {}, onErneut = {}, onBestaetigen = { _, _ -> }, onBestaetigungAbbrechen = {},
                )
            }
        }
    }

    @Test
    fun `ein Gutschein zeigt den PIN erst auf Wunsch`() {
        zeigeGutschein(schutz = { _, weiter -> weiter() })
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertIsDisplayed()
    }

    /** pruef6 N2: Wer das entsperrte Telefon kurz hat, sieht und kopiert keine PIN. */
    @Test
    fun `ohne Bestaetigung der Geraetesperre bleibt der PIN verdeckt`() {
        val gefragt = mutableListOf<String>()
        val kopiert = mutableListOf<String>()
        zeigeGutschein({ grund, _ -> gefragt += grund }, kopiert)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, "6061 2345 6789"))
            .performClick()
        assertEquals("Ohne Bestätigung nichts kopiert", emptyList<String>(), kopiert)
        assertEquals(List(2) { ctx.getString(R.string.schritt_gutschein) }, gefragt)
    }

    /** Die Nummer allein ist kein Geld, aber Klartext — auch sie erst nach der Sperre. */
    @Test
    fun `ohne Geraetesperre wird auch die Nummer nicht kopiert`() {
        val gefragt = mutableListOf<String>()
        val kopiert = mutableListOf<String>()
        zeigeGutschein({ grund, _ -> gefragt += grund }, kopiert)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_number, "6061 2345 6789"))
            .performClick()
        assertEquals("Ohne Bestätigung nichts kopiert", emptyList<String>(), kopiert)
        assertEquals(listOf(ctx.getString(R.string.schritt_gutschein)), gefragt)
    }

    /**
     * Die Rückfrage fragt nach dem Passwort; das Codefeld kommt erst, wenn der
     * Server es verlangt hat. Ohne Eingabe bleibt „Bestätigen“ aus. Getippt wird nicht:
     * Ein fokussiertes Feld blinkt, und Robolectric käme nie zur Ruhe.
     */
    @Test
    fun `die Rueckfrage zeigt das Codefeld erst auf Verlangen`() {
        zustand = zustand.copy(bestaetigung = GutscheinBestaetigung(GutscheinSchritt.PIN_ZEIGEN, 7))
        zeigeGutschein(schutz = { _, weiter -> weiter() })
        compose.onNodeWithText(ctx.getString(R.string.konto_password_current)).assertIsDisplayed()
        compose.onNodeWithText(ctx.getString(R.string.login_code)).assertDoesNotExist()
        compose.onNodeWithText(ctx.getString(R.string.vouchers_confirm_button)).assertIsNotEnabled()
        zustand = zustand.copy(bestaetigung = zustand.bestaetigung?.copy(codeNoetig = true, fehler = "Bitte den Code eingeben."))
        compose.onNodeWithText(ctx.getString(R.string.login_code)).assertIsDisplayed()
        compose.onNodeWithText("Bitte den Code eingeben.").assertIsDisplayed()
    }
}
