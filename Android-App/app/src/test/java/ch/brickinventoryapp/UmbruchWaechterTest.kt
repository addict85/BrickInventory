package ch.brickinventoryapp

import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.ui.screens.GalleryScreen
import ch.brickinventoryapp.ui.screens.LoginScreen
import ch.brickinventoryapp.ui.screens.PreisalarmeUnterseite
import ch.brickinventoryapp.ui.screens.SetDetailScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Kein Text bricht Zeichen für Zeichen um, und kein Knopf und keine Überschrift wird
 * gekürzt: Preisalarme, Sammlung, Set-Detail, Katalog-Detail und Anmeldung auf dem
 * Telefon (411 dp), je bei 100 und 200 % Schrift. Gemessen am Textlayout jedes
 * Textknotens: schmaler als etwa drei Zeichen, deutlich mehr Zeilen als Wörter, oder
 * in einem Knopf bzw. einer Überschrift mit Auslassung oder über den Rand.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   preisalarm-zeile-gequetscht      Plakette und „zuletzt …“ wieder in einer Row, die Plakette
 *                                    wieder mit dem langen Text → rot „Preisalarme bei 100 Prozent“
 *                                    („zuletzt CHF 449.95“ in 17 Zeilen bei 3 Wörtern)
 *   katalog-knoepfe-nebeneinander    Aufnehmen und Merken wieder nebeneinander, je eine Zeile mit
 *                                    Auslassung → rot „Katalog-Detail bei 100 Prozent“
 *                                    („Zur Sammlung hinzufügen“ gekürzt)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class UmbruchWaechterTest {

    @get:Rule
    val compose = createComposeRule()

    private val welt = Beispiele.Welt(KontextTexte())
    private val bilder = Beispielbilder.loader(ApplicationProvider.getApplicationContext())
    private val vorher = Locale.getDefault()

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    /** Wie BildschirmFotoTest: den Hauptlooper treiben, bis die Daten da sind und der Server ruht. */
    private fun treiben(name: String, bereit: () -> Boolean) {
        val ende = System.nanoTime() + 10_000_000_000L
        var anfragen = welt.pfade.anfragen.size
        var ruhigSeit = System.nanoTime()
        while (!bereit() || System.nanoTime() - ruhigSeit < 300_000_000L) {
            if (System.nanoTime() > ende) throw AssertionError("$name: Daten nach 10 s nicht da")
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
            val jetzt = welt.pfade.anfragen.size
            if (jetzt != anfragen) { anfragen = jetzt; ruhigSeit = System.nanoTime() }
        }
    }

    private fun pruefe(name: String, schrift: Float, bereit: () -> Boolean = { true }, inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-w411dp-h891dp-port-xxhdpi")
        if (schrift != 1f) RuntimeEnvironment.setFontScale(schrift)
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        treiben(name, bereit)
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        treiben("$name (angezeigt)", bereit)
        compose.waitForIdle()
        // Die Uhr anhalten und vorstellen: Einblendungen sind dann fertig gelaufen.
        compose.mainClock.autoAdvance = false
        repeat(20) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val (texte, befunde) = sammle(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode())
        // Leere Bildschirme prüfen nichts.
        assertTrue("$name: nur $texte Textknoten — sind die Daten da?", texte >= 5)
        assertTrue("$name: ${befunde.joinToString("; ")}", befunde.isEmpty())
    }

    /** Das Textlayout eines Knotens, ausser bei Eingabefeldern (deren Inhalt rollt). */
    private fun layout(n: SemanticsNode): TextLayoutResult? {
        if (n.config.getOrNull(SemanticsActions.SetText) != null) return null
        val liste = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(liste)
        return liste.firstOrNull()
    }

    private fun textknoten(n: SemanticsNode): Int = (if (layout(n) != null) 1 else 0) + n.children.sumOf { textknoten(it) }

    /**
     * Zählt die Textknoten und sammelt Befunde. Ein „Knopf“ ist ein Knoten mit der Rolle
     * Schaltfläche und höchstens zwei Texten darunter: Eine anklickbare Kachel trägt
     * die Rolle auch, darf ihren Namen aber nach zwei Zeilen kürzen.
     */
    private fun sammle(wurzel: SemanticsNode): Pair<Int, List<String>> {
        val befunde = mutableListOf<String>()
        var texte = 0
        fun lauf(n: SemanticsNode, imKnopf: Boolean, inUeberschrift: Boolean) {
            val knopf = imKnopf || (n.config.getOrNull(SemanticsProperties.Role) == Role.Button && textknoten(n) in 1..2)
            val kopf = inUeberschrift || n.config.getOrNull(SemanticsProperties.Heading) != null
            val l = layout(n)
            if (l != null && n.layoutInfo.isPlaced) {
                texte++
                val text = l.layoutInput.text.text
                val wo = "„${text.take(40)}“"
                val groesse = l.layoutInput.style.fontSize
                val em = if (groesse.isSp) with(l.layoutInput.density) { groesse.toPx() } else 0f
                val woerter = text.split(Regex("""\s+""")).count { it.isNotBlank() }
                val zeichen = text.count { !it.isWhitespace() }
                if (zeichen >= 3 && em > 0f && l.size.width < em * MINDESTBREITE_EM)
                    befunde += "$wo nur ${l.size.width} px breit (Schrift ${em.toInt()} px)"
                if (l.lineCount >= 3 && l.lineCount > 2 * woerter)
                    befunde += "$wo in ${l.lineCount} Zeilen bei $woerter Wörtern"
                // Nicht hasVisualOverflow: Darin steckt auch die Höhe, und die ragt unter
                // Robolectric bei fast jedem Text um Bruchteile über (Schriftmetrik).
                val gekuerzt = l.didOverflowWidth || l.multiParagraph.didExceedMaxLines ||
                    (0 until l.lineCount).any { l.isLineEllipsized(it) }
                if ((knopf || kopf) && gekuerzt) befunde += "$wo gekürzt (${if (knopf) "Knopf" else "Überschrift"})"
            }
            n.children.forEach { lauf(it, knopf, kopf) }
        }
        lauf(wurzel, imKnopf = false, inUeberschrift = false)
        return texte to befunde
    }

    // ── Die Bildschirme ──

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.dienste, SetsRepository(welt.t.api, welt.t.cache),
        KatalogRepository(welt.t.api, welt.t.cache), object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    private fun einstellungen() = welt.t.merke(EinstellungenViewModel(welt.t.dienste,
        ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.VerwaltungRepository(welt.t.api, welt.t.cache),
        SetsRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.TeileRepository(welt.t.api, welt.t.cache),
        object : ch.brickinventoryapp.ui.viewmodel.DateiLeser {
            override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null
        }))

    /** Ein Alarm scharf, einer ausgelöst mit letztem Preis — die Zeile, die zeichenweise umbrach. */
    private fun preisalarme(schrift: Float) {
        welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"},
            {"set_number":"10294-1","condition":"N","richtung":"ueber","schwelle":440.0,"currency_code":"CHF",
             "ausgeloest":true,"zuletzt_am":"2026-10-30T09:00:00Z","zuletzt_preis":449.95}]}"""
        val vm = einstellungen().also { it.ladeAlarmUebersicht() }
        pruefe("Preisalarme $schrift", schrift, { vm.alarmUebersicht.value.geladen }) {
            PreisalarmeUnterseite(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
        }
    }

    private fun galerie(schrift: Float) {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        pruefe("Sammlung $schrift", schrift,
            { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.galleryLoading } }) {
            GalleryScreen(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    private fun setDetail(schrift: Float) {
        val vm = welt.setDetail().also { it.ladeAlles() }
        pruefe("Set-Detail $schrift", schrift, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.setDetailLoading && !s.setPriceLoading && !s.priceHistoryLoading && !s.acquisitionsLoading } }) {
            SetDetailScreen(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    private fun katalogDetail(schrift: Float) {
        val detail = ch.brickinventoryapp.ui.model.KatalogDetailAnsicht(
            setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
            numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
            bricklink = ch.brickinventoryapp.ui.model.BrickLinkAnsicht(number = "10305-1",
                url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))
        pruefe("Katalog-Detail $schrift", schrift) {
            CatalogDetailScreen(setNumber = "10305-1", detail = detail, isLoading = false, imageLoader = bilder,
                serverUrl = "", onLoad = {}, onAddToGallery = { _, _, _, _, _, _ -> }, onWish = { _, _, _, _, _ -> },
                onOpenInGallery = {}, onBack = {})
        }
    }

    private fun anmeldung(schrift: Float) {
        pruefe("Anmeldung $schrift", schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
    }

    @Test fun `Preisalarme bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = preisalarme(1f)
    @Test fun `Preisalarme bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = preisalarme(2f)
    @Test fun `Sammlung bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = galerie(1f)
    @Test fun `Sammlung bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = galerie(2f)
    @Test fun `Set-Detail bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = setDetail(1f)
    @Test fun `Set-Detail bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = setDetail(2f)
    @Test fun `Katalog-Detail bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = katalogDetail(1f)
    @Test fun `Katalog-Detail bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = katalogDetail(2f)
    @Test fun `Anmeldung bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = anmeldung(1f)
    @Test fun `Anmeldung bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = anmeldung(2f)

    private companion object {
        /** Etwa drei schmale Zeichen: Ein Zeichen pro Zeile ist schmaler, „Neu“ breiter. */
        const val MINDESTBREITE_EM = 1.2f
    }
}
