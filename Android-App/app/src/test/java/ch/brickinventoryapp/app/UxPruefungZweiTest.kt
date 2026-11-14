package ch.brickinventoryapp.app

import android.content.Context
import android.graphics.Color as Farbe
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.gemeinsam.ui.ErfassungsFelder
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.sammlung.ui.dialogs.BarcodeDialogZustand
import ch.brickinventoryapp.sammlung.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.sammlung.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.sammlung.ui.screens.AddSetDialog
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.util.Locale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEreignisse
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringScreen
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringZustand
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.app.nav.AppZiel
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.sammlung.ui.screens.BarcodeScannerScreen
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.ProduktBild
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.remember
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.SemanticsMatcher
import ch.brickinventoryapp.teile.ui.PlSet
import ch.brickinventoryapp.teile.ui.TeilelisteUiState
import ch.brickinventoryapp.teile.ui.screens.PartsListScreen
import ch.brickinventoryapp.sammlung.ui.screens.GalerieUndDetail
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailRoute
import org.robolectric.RuntimeEnvironment

/**
 * Befunde der zweiten UX-Prüfung (Note 2), ausgeführt: was die Fotos zeigten, als Verhalten
 * geprüft — Telefon 411 dp, de-CH.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   kaufpreise-spaltenkoepfe        Spaltenkopf „Zustand“ wieder über den Zeilen → rot „M2 …“
 *   barcode-felder-ohne-hinweis     Barcode-Dialog ohne Hilfezeile unter der Anzahl → rot „M3 Barcode …“
 *   barcode-plakette-vor-nummer     „Schon in deiner Sammlung“ wieder zwischen Name und Nummer
 *                                   → rot „M3 Barcode …“
 *   preisspeicher-eingerueckt       Preisspeicher wieder mit eigenem Seitenrand → rot „M4 …“ (Einzug)
 *   hintergrund-titel-doppelt       Karte wieder mit dem Seitennamen → rot „M4 …“ (zweimal)
 *   netze-ohne-schalter             Netze ohne Schalterrolle → rot „M4 …“
 *   gutscheine-anlegen-oben         „Gutschein hinzufügen“ wieder über der Liste → rot „M5 …“ (schwebt nicht)
 *   bauliste-zahl-im-text           „(2 Sets)“ wieder als zweiter Text im Knopf → rot „N1 …“
 *   alarm-feld-nennt-richtung       Schwellenfeld wieder mit „Fällt unter“ beschriftet → rot „N2 …“
 *   alarm-feld-schmal               Felder wieder höchstens 320 dp breit → rot „N2 …“ (Rand)
 *   bildflaeche-hell-im-dunkeln     Bildgrund auch im Dunkeln Weiss → rot „N3 …“
 *   leiste-ohne-rand                Leiste wieder ohne Rand → rot „N4 die Leiste …“
 *   scanner-schliessen-rechts       Schliessen wieder oben rechts → rot „N4 der Scanner …“
 *   dialog-ohne-rand                Rückfrage und Erfassen ohne eigenen Rand → rot „N6 …“ (randlos)
 *   sprache-uebersetzt              auf Deutsch wieder „Englisch“ → rot „M7 …“
 *   portfolio-im-titel              „Wertentwicklung Portfolio“ zurück → rot „N5 …“
 *   galerie-ohne-detailflaeche      neben einem offenen Set nur das Detail → rot „M6 auf dem Tablet stehen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UxPruefungZweiTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val welt = Beispiele.Welt(KontextTexte())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    private fun text(id: Int, vararg werte: Any): String = if (werte.isEmpty()) ctx.getString(id) else ctx.getString(id, *werte)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    /** Den Hauptlooper treiben, bis [fertig] gilt; die Welt antwortet im Takt. */
    private fun warte(name: String, fertig: () -> Boolean) {
        treibeBis(name, anfragen = { welt.pfade.anfragen.size }, bereit = fertig)
        compose.waitForIdle()
    }

    /**
     * Öffnet [dialog] wie ein Antippen bei angehaltener Uhr und gibt die Wurzel seines
     * Fensters zurück: Ein Dialog mit Textfeld kommt unter Robolectric sonst nie zur Ruhe
     * (wie BildschirmFotoVariantenTest.zeigeDialog).
     */
    private fun oeffneDialog(dialog: @Composable () -> Unit): SemanticsNode {
        val offen = mutableStateOf(false)
        zeige { if (offen.value) dialog() }
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            offen.value = true
            Snapshot.sendApplyNotifications()
        }
        repeat(5) {
            compose.mainClock.advanceTimeBy(200)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val fenster = ShadowDialog.getLatestDialog().window!!.decorView
        return checkNotNull(composeWurzel(fenster)) { "kein Compose im Dialogfenster" }.semanticsOwner.unmergedRootSemanticsNode
    }

    private fun composeWurzel(v: View): ViewRootForTest? = when (v) {
        is ViewRootForTest -> v
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { composeWurzel(v.getChildAt(it)) }
        else -> null
    }

    /** Alle Texte unter [n] mit ihrer Lage im Fenster. */
    private fun texte(n: SemanticsNode): List<Pair<String, Rect>> =
        n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text to n.boundsInRoot } +
            n.children.flatMap { texte(it) }

    private fun lage(texte: List<Pair<String, Rect>>, gesucht: String): Rect =
        texte.firstOrNull { it.first == gesucht }?.second ?: error("„$gesucht“ fehlt in ${texte.map { it.first }}")

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise,
        SetsRepository(welt.t.api), welt.t.setKatalog(), welt.t.merkliste(), KatalogRepository(welt.t.api),
        object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    // ── M2: Kaufpreise ──

    @Test
    fun `M2 die Kaufpreise tragen Feldbeschriftungen statt Spaltenkoepfen`() {
        val vm = welt.t.merke(KaeufeViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.aenderungen,
            HaushaltRepository(welt.t.api), welt.t.sets(), FinanzenRepository(welt.t.api), TeileRepository(welt.t.api),
            FigurenRepository(welt.t.api)))
        zeige {
            AcquisitionManagementRoute(vm, type = Postenart.SET, id = Beispiele.SET, title = "Millennium Falcon", onBack = {})
        }
        warte("Kaufpreise") { vm.manDetailState.value.acquisitions.isNotEmpty() }
        val zeilen = vm.manDetailState.value.acquisitions.size
        assertEquals("Anzahl als Beschriftung je Zeile", zeilen,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.common_quantity))).fetchSemanticsNodes().size)
        assertEquals("Kaufpreis als Beschriftung je Zeile", zeilen,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.detail_purchase_price))).fetchSemanticsNodes().size)
        assertEquals("Spaltenkopf „Zustand“ steht noch da", 0,
            compose.onAllNodesWithText(text(R.string.common_condition)).fetchSemanticsNodes().size)
    }

    // ── M3: Erfassen-Formulare ──

    /** Was jedes Formular unter Anzahl, Preis und Lagerort sagt; die Anzahl je Gegenstand. */
    private fun pruefeHinweise(name: String, texte: List<String>, anzahlHinweis: Int) {
        for (hinweis in listOf(text(anzahlHinweis), text(R.string.common_unit_price_placeholder), text(R.string.detail_storage_ph)))
            assertTrue("$name: Hinweis „$hinweis“ fehlt", hinweis in texte)
    }

    @Test
    fun `M3 Set-Erfassen nennt Anzahl, Preis und Lagerort mit Hilfezeile`() {
        val wurzel = oeffneDialog { AddSetDialog(onDismiss = {}, onAdd = {}, lagerorte = listOf("Keller"), sofortFokus = false) }
        pruefeHinweise("Set", texte(wurzel).map { it.first }, R.string.gallery_quantity_hint)
    }

    @Test
    fun `M3 Teile-Erfassen nennt Anzahl, Preis je Stueck und Lagerort mit Hilfezeile`() {
        zeige {
            Column {
                ErfassungsFelder(anzahl = "1", onAnzahl = {}, anzahlHinweis = text(R.string.parts_quantity_hint),
                    preis = "", onPreis = {}, zustand = Zustand.NEU, onZustand = {})
            }
        }
        val alle = texte(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode()).map { it.first }
        pruefeHinweise("Teil", alle, R.string.parts_quantity_hint)
        assertTrue("Preis je Stück ausgeschrieben", text(R.string.common_unit_price) in alle)
    }

    @Test
    fun `M3 Barcode nennt die Nummer beim Namen und hat dieselben Hilfezeilen`() {
        val zustand = BarcodeDialogZustand(AppUiState(), BlickfeldUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", besitzMenge = 1), LagerUiState())
        val wurzel = oeffneDialog { BarcodeResultDialog(zustand, erfassung(), Beispielbilder.loader(ctx)) }
        val alle = texte(wurzel)
        pruefeHinweise("Barcode", alle.map { it.first }, R.string.gallery_quantity_hint)
        val name = lage(alle, "Millennium Falcon")
        val nummer = lage(alle, "75192-1")
        val plakette = lage(alle, text(R.string.barcode_schon_besessen, 1))
        assertTrue("M3 Barcode: Nummer gleich unter dem Namen ($name / $nummer / $plakette)",
            name.bottom <= nummer.top && nummer.bottom <= plakette.top)
    }

    // ── M4: Hintergrundarbeiten ──

    @Test
    fun `M4 Hintergrundarbeiten mit einem Titel, buendigen Karten, eigener Darstellung und Schaltern`() {
        welt.pfade.antworten["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[{"id":"17","art":"bilder","status":"laeuft","versuche":1,"max_versuche":5,
               "faellig_ab":"2026-10-30T10:00:00Z","frist_bis":null,"gestartet":null,"erstellt":"2026-10-30T09:59:00Z",
               "aktualisiert":null,"fortschritt":null,"fehler":null,"user_id":4,"geplant":false,"set_number":"75192-1"}],
            "zusammenfassung":[],"pausen":[],"bildbedarf":0,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val vm = MonitoringViewModel(VerwaltungRepository(welt.t.api), KontoRepository(welt.t.api, welt.t.io),
            KontextTexte(), welt.t.meldungen)
        runBlocking { vm.ladeHintergrund() }
        val netze = mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false)
        zeige {
            MonitoringScreen(MonitoringZustand(MonitoringUiState(), vm.hintergrund.value, VerwaltungUiState(),
                netze, Design.CLASSIC, 0L), vm, CacheEreignisse({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> }))
        }
        assertEquals("M4: „Hintergrundarbeiten“ zweimal", 1,
            compose.onAllNodesWithText(text(R.string.monitoring_title)).fetchSemanticsNodes().size)
        fun links(id: Int) = compose.onNode(hasText(text(id)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        val auftraege = links(R.string.hintergrund_auftraege)
        for (id in listOf(R.string.monitoring_price_cache, R.string.monitoring_darstellung_vorgabe))
            assertEquals("M4: Einzug von „${text(id)}“", auftraege, links(id), 1f)
        for ((netz, an) in listOf(R.string.monitoring_vorwaermen_wlan to ToggleableState.On,
                                  R.string.monitoring_vorwaermen_mobil to ToggleableState.Off)) {
            val knoten = compose.onNode(hasText(text(netz))).fetchSemanticsNode()
            assertEquals("M4: ${text(netz)} ist kein Schalter", Role.Switch, knoten.config.getOrNull(SemanticsProperties.Role))
            assertEquals("M4: ${text(netz)} zeigt nicht, ob an", an, knoten.config.getOrNull(SemanticsProperties.ToggleableState))
        }
    }

    // ── M5: Gutscheine ──

    @Test
    fun `M5 Gutscheine anlegen schwebt, Guthaben und PDF stehen im Menue der Leiste`() {
        zeige { Gutscheine() }
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            assertEquals("M5: „${text(id)}“ steht ohne Menü da", 0, compose.onAllNodesWithText(text(id)).fetchSemanticsNodes().size)
        val anlegen = compose.onNode(hasText(text(R.string.vouchers_add)) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val hoehe = ctx.resources.displayMetrics.heightPixels
        assertTrue("M5: Anlegen schwebt nicht unten (${anlegen.bottom} von $hoehe)", anlegen.bottom > hoehe * 0.8f)
        compose.onNodeWithContentDescription(text(R.string.vouchers_menu_cd)).performClick()
        compose.waitForIdle()
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            compose.onNodeWithText(text(id)).fetchSemanticsNode("M5: „${text(id)}“ fehlt im Menü")
    }

    // ── M6: Tablet mit Liste und Detail ──

    /** Galerie und Set-Detail auf dem Tablet (1280 dp); ohne [offen] steht rechts der Hinweis. */
    private fun galerieUndDetail(offen: String?) {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        val detail = welt.setDetail()
        zeige {
            GalerieUndDetail(galerie, erfassung(), Beispielbilder.loader(ctx), offen = offen, onSetClick = {}, onScanBarcode = {}) {
                SetDetailRoute(setNumber = Beispiele.SET, vm = detail, serverUrl = "", imageLoader = Beispielbilder.loader(ctx),
                    onBack = {}, onDelete = {})
            }
        }
        warte("Galerie und Detail") {
            galerie.galleryState.value.sets.isNotEmpty() &&
                (offen == null || detail.setDetailState.value.let { it.setDetail != null && !it.setDetailLoading })
        }
    }

    @Test
    fun `M6 auf dem Tablet stehen Galerie und Set-Detail gleichzeitig nebeneinander`() {
        galerieUndDetail(Beispiele.SET)
        val breite = ctx.resources.displayMetrics.widthPixels
        val kachel = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val wert = compose.onNode(hasText(text(R.string.detail_pnl_tile)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("M6: Detail nicht rechts der Liste ($kachel / $wert)", kachel.right <= wert.left)
        assertTrue("M6: Detail ausserhalb des Fensters ($wert / $breite)", wert.right <= breite + 1f && kachel.left >= 0f)
    }

    @Test
    fun `M6 auf dem Tablet steht ohne gewaehltes Set rechts ein Hinweis neben der Galerie`() {
        galerieUndDetail(null)
        val kachel = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val hinweis = compose.onNode(hasText(text(R.string.gallery_detail_leer))).fetchSemanticsNode().boundsInRoot
        assertTrue("M6: Hinweis nicht rechts der Liste ($kachel / $hinweis)", kachel.right <= hinweis.left)
    }

    // ── N1: Bauliste bei 200 % ──

    @Test
    fun `N1 Bauliste erstellen bleibt bei 200 Prozent einzeilig und nennt die Zahl der Sets`() {
        val sets = listOf(PlSet("75192-1", "Millennium Falcon"), PlSet("21318-1", "Baumhaus"))
        zeige(schrift = 2f) { PartsListScreen(TeilelisteUiState(sets = sets), serverUrl = "", imageLoader = Beispielbilder.loader(ctx), onScanBarcode = {}) }
        val knopf = compose.onNode(hasText(text(R.string.partslist_generate)) and hasClickAction()).fetchSemanticsNode()
        fun zeilen(n: SemanticsNode): List<Int> {
            val layouts = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
            return layouts.map { it.lineCount } + n.children.flatMap { zeilen(it) }
        }
        val unten = compose.onNode(hasText(text(R.string.partslist_generate)), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue("N1: „Bauliste erstellen“ bricht um: ${zeilen(unten)}", zeilen(unten).all { it == 1 })
        val anzahl = ctx.resources.getQuantityString(R.plurals.partslist_generate_anzahl, 2, 2)
        assertTrue("N1: Zahl der Sets fehlt am Knopf",
            compose.onAllNodes(hasContentDescription(anzahl), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue("N1: Zahl steht als zweiter Text im Knopf",
            knopf.config.getOrNull(SemanticsProperties.Text).orEmpty().none { it.text == anzahl })
    }

    // ── N2: Preisalarme ──

    @Test
    fun `N2 Preisalarme nennen die Richtung einmal und enden am Rand der Karte`() {
        welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"}]}"""
        val vm = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.abgleich,
            KontoRepository(welt.t.api, welt.t.io), VerwaltungRepository(welt.t.api), welt.t.alarme(), TeileRepository(welt.t.api),
            object : DateiLeser {
                override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
            })).also { it.ladeAlarmUebersicht() }
        zeige {
            PreisalarmeRoute(vm = vm, imageLoader = Beispielbilder.loader(ctx), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
        }
        warte("Preisalarme") { vm.alarmUebersicht.value.geladen && vm.alarmUebersicht.value.alarme.isNotEmpty() }
        // Je eine Wahl im Alarm und im Formular zum Anlegen, nicht noch einmal als Feldname.
        assertEquals("N2: „Fällt unter“ doppelt", 2,
            compose.onAllNodes(hasText(text(R.string.detail_alert_chip_below)), useUnmergedTree = true)
                .fetchSemanticsNodes().count { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null })
        val vorn = text(R.string.alerts_delete_fuer, "§").substringBefore("§")
        val loeschen = compose.onAllNodes(SemanticsMatcher("Löschen eines Alarms") { n ->
            n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.startsWith(vorn) }
        }).fetchSemanticsNodes().first().boundsInRoot
        val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        assertEquals("N2: Feld endet nicht am Rand der Karte (${feld.right} / ${loeschen.right})", loeschen.right, feld.right,
            ctx.resources.displayMetrics.density)
    }

    // ── N3: dunkle Designs ──

    @Test
    fun `N3 im Dunkeln liegt das Bild auf einer dunklen Flaeche`() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC, dunkel = true) {
                ProduktBild(model = "/beispiel/set1.png", imageLoader = Beispielbilder.loader(ctx), contentDescription = "Bild",
                    modifier = Modifier.size(300.dp, 100.dp), bildgrund = true)
            }
        }
        compose.waitForIdle()
        val bild = compose.onNodeWithContentDescription("Bild").captureToImage().asAndroidBitmap()
        // Links neben dem Bild, das mit „Fit“ mittig steht: nur die Fläche.
        val punkt = bild.getPixel(2, bild.height / 2)
        val hell = (Farbe.red(punkt) + Farbe.green(punkt) + Farbe.blue(punkt)) / 3
        assertTrue("N3: Bildfläche im Dunkeln hell (Grauwert $hell)", hell < 80)
    }

    // ── N4: Leiste bei 200 %, Scanner ──

    @Test
    fun `N4 die Leiste haelt bei 200 Prozent Abstand zum Bildschirmrand`() {
        zeige(schrift = 2f) {
            val nav = rememberNavController()
            val reiter = remember {
                listOf(Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Reiter(AppZiel.Mehr, { Icon(Icons.Default.MoreHoriz, null) }, "Mehr"))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) { composable<SammlungZiel.Gallery> { } }
            }
        }
        val dichte = ctx.resources.displayMetrics.density
        val breite = ctx.resources.displayMetrics.widthPixels
        val mehr = compose.onNode((hasText("Mehr") or hasContentDescription("Mehr")) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("N4: „Mehr“ endet ${(breite - mehr.right) / dichte} dp vor dem Rand", breite - mehr.right >= 6 * dichte)
    }

    @Test
    fun `N4 der Scanner schliesst oben links und schaltet das Licht ueber einen Knopf`() {
        zeige { BarcodeScannerScreen(onResult = {}, onDismiss = {}, ohneKamera = true) }
        val breite = ctx.resources.displayMetrics.widthPixels
        val zu = compose.onNodeWithContentDescription(text(R.string.scanner_close)).fetchSemanticsNode().boundsInRoot
        assertTrue("N4: Schliessen nicht links (${zu.left} von $breite)", zu.right < breite / 2f)
        compose.onNode(hasText(text(R.string.scanner_torch_on)) and hasClickAction()).fetchSemanticsNode("N4: Licht ist kein Knopf")
    }

    // ── N6: Dialoge mit Rand ──

    /** Der Rahmen des Dialogs: der Knoten mit seinem Fensternamen. */
    private fun rahmen(n: SemanticsNode, titel: String): Rect? =
        if (n.config.getOrNull(SemanticsProperties.PaneTitle) == titel) n.boundsInRoot
        else n.children.firstNotNullOfOrNull { rahmen(it, titel) }

    private fun pruefeRand(name: String, wurzel: SemanticsNode, titel: String) {
        val dichte = ctx.resources.displayMetrics.density
        val breite = ctx.resources.displayMetrics.widthPixels
        val r = checkNotNull(rahmen(wurzel, titel)) { "$name: kein Fenster „$titel“" }
        assertTrue("N6: $name randlos (${r.left / dichte} / ${(breite - r.right) / dichte} dp)",
            r.left >= 23 * dichte && breite - r.right >= 23 * dichte)
    }

    @Test
    fun `N6 Rueckfrage und Erfassen halten Abstand zum Fensterrand`() {
        val wurzel = oeffneDialog {
            Rueckfrage(titel = "Set löschen?", text = "Millennium Falcon wird entfernt.", bestaetigen = "Löschen",
                onBestaetigen = {}, onAbbrechen = {})
        }
        pruefeRand("Rückfrage", wurzel, "Set löschen?")
    }

    @Test
    fun `N6 Set-Erfassen haelt Abstand zum Fensterrand`() {
        val wurzel = oeffneDialog { AddSetDialog(onDismiss = {}, onAdd = {}, sofortFokus = false) }
        pruefeRand("Set erfassen", wurzel, text(R.string.gallery_add_set_title))
    }

    // ── M7: Sprachauswahl ──

    /** Wer die falsche Sprache eingestellt hat, findet seine an ihrem eigenen Namen. */
    @Test
    fun `M7 die Sprachen heissen in beiden Sprachen so, wie sie sich selbst nennen`() {
        for (sprache in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(sprache)
            assertEquals("M7 ($sprache)", listOf("English", "Deutsch"),
                listOf(text(R.string.settings_language_en), text(R.string.settings_language_de)))
        }
    }

    // ── N5: Sammlung statt Portfolio ──

    @Test
    fun `N5 die Wertentwicklung heisst nach der Sammlung`() {
        for (id in listOf(R.string.chart_portfolio_value, R.string.chart_summary, R.string.chart_summary_no_change))
            assertTrue("N5: „${text(id)}“", "Sammlung" in text(id) && "Portfolio" !in text(id))
    }
}
