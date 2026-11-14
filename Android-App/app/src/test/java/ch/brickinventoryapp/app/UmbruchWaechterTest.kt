package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
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
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.anmeldung.ui.AnmeldeFormular
import ch.brickinventoryapp.katalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.sammlung.ui.screens.GalleryRoute
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
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
import org.robolectric.annotation.GraphicsMode
import java.util.Locale
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.model.ui.model.BrickLinkAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEreignisse
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringScreen
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringZustand
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.runBlocking

/**
 * Kein Text bricht Zeichen für Zeichen oder im Wort um, keiner ragt über seinen Platz,
 * kein Knopf und keine Überschrift wird gekürzt: Preisalarme, Sammlung, Set-Detail,
 * Katalog-Detail und Anmeldung auf dem Telefon (411 dp) bei 100 und 200 % Schrift, dazu
 * die Hintergrundarbeiten (100 %) und das Set-Detail mit vierstelligen Beträgen (360 dp).
 *
 * Gemessen am Textlayout jedes Textknotens: schmaler als etwa drei Zeichen, mehr Zeilen
 * als Wörter, ein Zeilenende zwischen zwei Buchstaben, eine Zeile breiter als der Text.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   preisalarm-zeile-gequetscht      Plakette und „zuletzt …“ wieder in einer Row, die Plakette
 *                                    wieder mit dem langen Text → rot „Preisalarme bei 100 Prozent“
 *                                    („zuletzt CHF 449.95“ in 17 Zeilen bei 3 Wörtern)
 *   katalog-knoepfe-nebeneinander    Aufnehmen und Merken wieder nebeneinander, je eine Zeile mit
 *                                    Auslassung → rot „Katalog-Detail bei 100 Prozent“
 *                                    („Zur Sammlung hinzufügen“ gekürzt)
 *   standard-zustand-in-der-zeile    „Standard-Zustand“ wieder neben der Wahl → rot
 *                                    „Hintergrundarbeiten bei 100 Prozent“ („Gebraucht“ im Wort gebrochen)
 *   gewinn-in-einer-zeile            Gewinn/Verlust wieder stets einzeilig → rot „Set-Detail schmal
 *                                    bei 200 Prozent“ („+CHF 200.90 · +19.2%“ ragt hinaus)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
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

    /** Wie BildschirmFotoTest: den Hauptlooper treiben, bis die Daten da sind und die Welt ruht. */
    private fun treiben(name: String, bereit: () -> Boolean) =
        treibeBis(name, anfragen = { welt.pfade.anfragen.size }, bereit = bereit)

    private fun pruefe(name: String, schrift: Float, bereit: () -> Boolean = { true },
                       geraet: String = "w411dp-h891dp-port-xxhdpi", inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-$geraet")
        if (schrift != 1f) RuntimeEnvironment.setFontScale(schrift)
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        treiben(name, bereit)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
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
                befunde += auffaelligkeiten(l, knopf, kopf)
            }
            n.children.forEach { lauf(it, knopf, kopf) }
        }
        lauf(wurzel, imKnopf = false, inUeberschrift = false)
        return texte to befunde
    }

    /** Was an einem gesetzten Text auffällt: zu schmal, Buchstabe je Zeile, gekürzt in Knopf oder Überschrift. */
    private fun auffaelligkeiten(l: TextLayoutResult, knopf: Boolean, kopf: Boolean): List<String> {
        val befunde = mutableListOf<String>()
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
        befunde += imWortOderUeberDenRand(l, wo, em)
        // Nur die Auslassung zählt: Breite, Höhe und maxLines melden unter
        // Robolectric auch bei ungekürzten Texten einen Überlauf (Schriftmetrik).
        val gekuerzt = (0 until l.lineCount).any { l.isLineEllipsized(it) }
        if ((knopf || kopf) && gekuerzt) befunde += "$wo gekürzt (${if (knopf) "Knopf" else "Überschrift"}; " +
            "Zeilen ${l.lineCount}, Breite ${l.size.width}/${l.multiParagraph.width.toInt()}, " +
            "Überlauf B ${l.didOverflowWidth} H ${l.didOverflowHeight}, maxLines ${l.multiParagraph.didExceedMaxLines})"
        return befunde
    }

    /**
     * „Gebrauch|t“: ein Zeilenende zwischen zwei Buchstaben oder Ziffern bricht das Wort
     * selbst. Und eine Zeile, breiter als ihr Platz: Der Rest ist abgeschnitten.
     */
    private fun imWortOderUeberDenRand(l: TextLayoutResult, wo: String, em: Float): List<String> {
        val text = l.layoutInput.text.text
        val befunde = mutableListOf<String>()
        val imWort = (0 until l.lineCount - 1).map { l.getLineEnd(it) }
            .firstOrNull { e -> e in 1 until text.length && text[e - 1].isLetterOrDigit() && text[e].isLetterOrDigit() }
        if (imWort != null) befunde += "$wo im Wort gebrochen nach „${text.take(imWort).takeLast(12)}“"
        val ueberstand = (0 until l.lineCount).maxOf { l.getLineRight(it) } - l.size.width
        if (em > 0f && ueberstand > em * UEBERSTAND_EM) befunde += "$wo ragt ${ueberstand.toInt()} px über den Rand"
        return befunde
    }

    // ── Die Bildschirme ──

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, SetsRepository(welt.t.api), welt.t.setKatalog(), welt.t.merkliste(),
        KatalogRepository(welt.t.api),
        object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    private fun einstellungen() = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.abgleich,
        KontoRepository(welt.t.api, welt.t.io), VerwaltungRepository(welt.t.api),
        welt.t.alarme(), TeileRepository(welt.t.api),
        object : DateiLeser {
            override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
        }))

    /** Ein Alarm scharf, einer ausgelöst mit letztem Preis — die Zeile, die zeichenweise umbrach. */
    private fun preisalarme(schrift: Float) {
        welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"},
            {"set_number":"10294-1","condition":"N","richtung":"ueber","schwelle":440.0,"currency_code":"CHF",
             "ausgeloest":true,"zuletzt_am":"2026-10-30T09:00:00Z","zuletzt_preis":449.95}]}"""
        val vm = einstellungen().also { it.ladeAlarmUebersicht() }
        pruefe("Preisalarme $schrift", schrift, { vm.alarmUebersicht.value.geladen }) {
            PreisalarmeRoute(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
        }
    }

    private fun galerie(schrift: Float) {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        pruefe("Sammlung $schrift", schrift,
            { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.galleryLoading } }) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    private fun setDetail(schrift: Float) {
        val vm = welt.setDetail()
        pruefe("Set-Detail $schrift", schrift, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.setDetailLoading && !s.setPriceLoading && !s.priceHistoryLoading && !s.acquisitionsLoading } }) {
            SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    private fun katalogDetail(schrift: Float) {
        val detail = KatalogDetailAnsicht(
            setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
            numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
            bricklink = BrickLinkAnsicht(number = "10305-1",
                url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))
        pruefe("Katalog-Detail $schrift", schrift) {
            CatalogDetailScreen(setNumber = "10305-1", detail = detail, isLoading = false, imageLoader = bilder,
                serverUrl = "", onLoad = {}, onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
    }

    /** Vierstellige Beträge auf 360 dp: „+CHF 200.90 · +19.2%“ ist breiter als die Kachel. */
    private fun setDetailSchmal(schrift: Float) {
        welt.pfade.antworten["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":1249.9,"min_price":1180.0,"max_price":1320.0,"qty_avg_price":1249.9}"""
        welt.pfade.antworten["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        welt.pfade.antworten["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":"19.2","pnl_prozent":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
        val vm = welt.setDetail()
        pruefe("Set-Detail schmal $schrift", schrift, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.setDetailLoading && !s.setPriceLoading && !s.priceHistoryLoading && !s.acquisitionsLoading } },
            geraet = "w360dp-h740dp-port-xxhdpi") {
            SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    /** Wie das Foto der Hintergrundarbeiten: ein laufender Auftrag, darunter der Preisspeicher. */
    private fun hintergrundarbeiten(schrift: Float) {
        welt.pfade.antworten["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[
              {"id":"17","art":"bilder","status":"laeuft","versuche":1,"max_versuche":5,"faellig_ab":"2026-10-30T10:00:00Z",
               "frist_bis":null,"gestartet":"2026-10-30T10:00:05Z","erstellt":"2026-10-30T09:59:00Z","aktualisiert":null,
               "fortschritt":{"erledigt":3,"gesamt":12,"text":"Bilder"},"fehler":null,"user_id":4,"geplant":false,"set_number":"75192-1"}],
            "zusammenfassung":[],"pausen":[],"bildbedarf":7,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val vm = MonitoringViewModel(VerwaltungRepository(welt.t.api), KontoRepository(welt.t.api, welt.t.io), KontextTexte(), welt.t.meldungen)
        runBlocking { vm.ladeHintergrund() }
        val ereignisse = CacheEreignisse({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        pruefe("Hintergrundarbeiten $schrift", schrift) {
            MonitoringScreen(MonitoringZustand(MonitoringUiState(), vm.hintergrund.value, VerwaltungUiState(),
                emptyMap(), Design.CLASSIC, 0L), vm, ereignisse)
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
    @Test fun `Set-Detail schmal bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = setDetailSchmal(1f)
    @Test fun `Set-Detail schmal bei 200 Prozent ohne Zeichenumbruch und Kuerzung`() = setDetailSchmal(2f)
    @Test fun `Hintergrundarbeiten bei 100 Prozent ohne Zeichenumbruch und Kuerzung`() = hintergrundarbeiten(1f)

    private companion object {
        /** Etwa drei schmale Zeichen: Ein Zeichen pro Zeile ist schmaler, „Neu“ breiter. */
        const val MINDESTBREITE_EM = 1.2f
        /** Mehr als ein halbes Zeichen über den Rand; darunter liegt die Ungenauigkeit der Schriftmetrik. */
        const val UEBERSTAND_EM = 0.5f
    }
}
