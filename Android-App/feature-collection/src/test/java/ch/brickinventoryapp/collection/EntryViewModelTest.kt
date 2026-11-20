package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.testing.testCatalogRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * Das Erfassungs-ViewModel: Scan, Erfassen über die Setnummer, Prüfanzeige.
 * Der Ereignisstrom des Anlegens ist nachgebaut ([SetCreator]), alles andere
 * läuft im Takt gegen einen PfadServer; „unterwegs“ heisst zurückgehalten.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen EntryViewModel.kt):
 *   A  in showExisting() `exists` ignoriert (immer false) → rot „ein
 *      gescanntes Set, das schon da ist, wird geöffnet …“
 *   B  das `finally` in resolveBarcode() entfernt → rot „ein erfolgloser Scan
 *      öffnet die manuelle Erfassung …“ (die Prüfanzeige bleibt stehen)
 *   C  beim Anlegen den Stammdaten-Schritt nicht angezeigt → rot „das Anlegen
 *      zeigt die Schritte des Servers …“
 *   D  einen leeren Fehler als Satz des Servers gewertet → rot „ein
 *      abgebrochener Ereignisstrom ist ein Netzfehler …“
 *   E  in confirmAddBarcode() die Sperre `if (stand.hinzufuegen.laeuft) return` entfernt →
 *      rot „ein zweiter Klick auf Bestätigen …“; ebenso, wenn der Dialog erst
 *      nach der Antwort schliesst oder der Eigentümer nicht mitgeht
 *   F  `hinzufuegen = Vorgang.Fertig` nach der Antwort entfernt → rot „ein Fehlschlag beim
 *      Bestätigen …“ und „ein zweiter Klick …“
 *   G  im Teilelisten-Zweig das `return` entfernt → rot „aus der Teileliste
 *      wird nichts angelegt …“
 *   H  in useScannedSetNumber() die Vorabfrage übersprungen → rot „die
 *      Texterkennung fragt den Server …“ und „ein Fehler der Vorabfrage …“
 *   I  in showExisting() bei einem Fehler weitergemacht → rot „ein Fehler
 *      der Vorabfrage bricht ab …“
 *   J  bei gescheiterter Katalogabfrage keine manuelle Erfassung → rot „jeder
 *      erfolglose Weg …“
 *   K  in abortCheckAb() den Job nicht abgebrochen → rot „der Abbruch …“
 *      und „das Abmelden …“
 *   L  in zuruecksetzen() die Prüfung nicht abgebrochen → rot „das Abmelden
 *      räumt die Prüfanzeige mit“
 *   M  im Fehlerzweig von resolveBarcode() wieder immer „nicht gefunden“ →
 *      rot „ein Serverfehler beim Scan heisst nicht …“; den Code nicht
 *      abgefragt (immer die Meldung) → rot „ein erfolgloser Scan …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EntryViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    /** Lässt die Testuhr laufen, bis nichts mehr ansteht, und prüft dann [bedingung]. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        clock.advanceUntilIdle()
        assertTrue(was, bedingung())
    }

    /** Wie NumbersTexts, aber mit den Argumenten — der Test prüft auch, WAS eingesetzt wurde. */
    private object TextsWithArguments : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id" + args.joinToString("") { "|$it" }
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: Ergebnis.Fehler) = "fehler"
        override fun angemeldet() = true
    }

    /** Spielt die Schritte ab und schreibt die Prüfphasen mit, die dabei zu sehen waren. */
    private class Creator(val schritte: List<SetCreateStep>) : SetCreator {
        var vm: EntryViewModel? = null
        val gesehen = mutableListOf<CheckPhase?>()
        override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                             ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = flow {
            for (s in schritte) {
                emit(s)
                gesehen += vm?.entryState?.value?.check?.phase
            }
        }
    }

    private fun vm(creator: Creator = Creator(emptyList())) = t.merke(
        EntryViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setCatalog(), t.merkliste(), testCatalogRepository(t.api), creator)
    ).also { creator.vm = it }

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        paths = PfadServer(
            "/api/v1/sets/barcode/5702016616316" to """{"success":true,"set_number":"75192-1","name":"Falke"}""",
            "/api/v1/sets/exists/75192-1" to """{"success":true,"exists":true,"set_number":"75192-1"}""",
            "/api/v1/wanted" to """{"success":true,"war_neu":true}""",
        )
        t = TestDienste(paths.imTakt(), TextsWithArguments, io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `ein gescanntes Set, das schon da ist, wird geoeffnet statt erfasst`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.GALERIE_SUCHE)
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        assertNull("Kein Bestätigungsdialog", vm.barcodeState.value.result)
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `ein erfolgloser Scan oeffnet die manuelle Erfassung und raeumt die Pruefanzeige`() {
        paths.antworten["/api/v1/sets/barcode/0000"] = """{"success":false,"code":"barcode_kein_set","error":"Kein Set"}"""
        paths.codes["/api/v1/sets/barcode/0000"] = 404
        val vm = vm()
        vm.resolveBarcode("0000")
        bis("manuell") { vm.barcodeState.value.manuelleErfassungAnfordern }
        assertEquals("t${R.string.vm_barcode_not_found}|0000", t.meldungen.text)
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `ein Serverfehler beim Scan heisst nicht, das Set gebe es nicht`() {
        paths.antworten["/api/v1/sets/barcode/0001"] = """{"success":false,"code":"interner_fehler"}"""
        paths.codes["/api/v1/sets/barcode/0001"] = 500
        val vm = vm()
        vm.resolveBarcode("0001")
        bis("manuell") { vm.barcodeState.value.manuelleErfassungAnfordern }
        assertEquals("fehler", t.meldungen.text)
    }

    @Test
    fun `das Anlegen zeigt die Schritte des Servers und meldet das neue Set`() {
        val creator = Creator(listOf(
            SetCreateStep.Stammdaten("Falke"), SetCreateStep.Bild, SetCreateStep.FastDone,
            SetCreateStep.Fertig(SetRecorded(nummer = "75192-1", angelegt = true)),
        ))
        val vm = vm(creator)
        vm.addSet(Erfassungswunsch("75192"))
        bis("fertig") { vm.entryState.value.check == null && t.meldungen.text != null }
        assertEquals(listOf(CheckPhase.ANLEGEN_STAMMDATEN, CheckPhase.ANLEGEN_BILD, CheckPhase.ANLEGEN_ABSCHLUSS),
            creator.gesehen.take(3))
        assertEquals("t${R.string.vm_added}|75192-1", t.meldungen.text)
        // Name und Bild kennt erst der Server: Die Ablage holt die Galerie nach.
        bis("nachgezogen") { paths.requestsAn("GET /api/v1/sets?").isNotEmpty() }
    }

    /**
     * Gegenprobe (am 28.10.2026 gemessen, kotlinc): den Zweig `katalogOffen`
     * entfernt → rot, gemeldet wird „hinzugefügt“ (vm_added).
     */
    @Test
    fun `ohne Katalog meldet das Anlegen gespeichert, nicht hinzugefuegt`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fertig(
            SetRecorded(nummer = "99999-1", angelegt = true, katalogOffen = true)))))
        vm.addSet(Erfassungswunsch("99999"))
        bis("Meldung") { t.meldungen.text != null }
        assertEquals("t${R.string.vm_set_added_no_catalog}|99999-1", t.meldungen.text)
    }

    @Test
    fun `ein vorhandenes Set beim Anlegen oeffnet die Detailansicht und meldet nichts`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fertig(SetRecorded(nummer = "75192-1", vorhanden = true)))))
        vm.addSet(Erfassungswunsch("75192-1"))
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        assertTrue("nichts angelegt, nichts nachzuziehen", paths.requestsAn("GET /api/v1/sets?").isEmpty())
    }

    @Test
    fun `ein abgebrochener Ereignisstrom ist ein Netzfehler, kein Satz des Servers`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fehler(""))))
        vm.addSet(Erfassungswunsch("75192-1"))
        bis("gemeldet") { t.meldungen.text != null }
        // Ein Netzfehler wird über meldung() formuliert ("fehler"); ein Satz
        // des Servers käme unverändert — hier leer — und sagte nichts.
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.text)
    }

    @Test
    fun `ein Scan aus der Merkliste legt einen Merkposten an und schliesst den Dialog`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.MERKLISTE)
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", zustand = Zustand.GEBRAUCHT))
        bis("gemeldet") { t.meldungen.text != null }
        val merkliste = runBlocking { t.merkliste().observeWanted().first().liste }
        assertEquals("der Merkposten steht in der Ablage", listOf("75192-1"), merkliste.map { it.setNumber })
        assertEquals("t${R.string.wanted_added}", t.meldungen.text)
        assertTrue(paths.requestsAn("POST /api/v1/wanted").isNotEmpty())
        assertNull(vm.barcodeState.value.result)
    }

    /** Ein Scan bis zum Bestätigungsdialog (Quelle Galerie, also ohne Vorabfrage). */
    private fun untilToDialog(): EntryViewModel {
        val vm = vm()
        vm.resolveBarcode("5702016616316")
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        return vm
    }

    @Test
    fun `ein zweiter Klick auf Bestaetigen legt das Set nicht zweimal an`() {
        paths.antworten["/api/v1/sets"] = """{"success":true,"action":"added","set_number":"75192-1"}"""
        paths.ausbleibend += "/api/v1/sets"
        val vm = untilToDialog()
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", besitzer = 2))
        // Der Dialog schliesst sofort, und angelegt wird im Hintergrund — ohne Prüfanzeige.
        assertNull(vm.barcodeState.value.result)
        assertTrue(vm.barcodeState.value.hinzufuegen.laeuft)
        assertNull(vm.entryState.value.check)
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", besitzer = 2))
        paths.freigeben()
        bis("fertig") { !vm.barcodeState.value.hinzufuegen.laeuft }
        assertEquals(1, paths.requestsAn("POST /api/v1/sets").size)
        val rumpf = paths.koerper[paths.requests.indexOf("POST /api/v1/sets")]
        assertTrue(rumpf, "\"owner_user_id\":2" in rumpf)
    }

    @Test
    fun `ein Fehlschlag beim Bestaetigen nennt die Setnummer und gibt den Knopf frei`() {
        paths.codes["/api/v1/sets"] = 500
        val vm = untilToDialog()
        vm.confirmAddBarcode(Erfassungswunsch("75192-1"))
        bis("gemeldet") { t.meldungen.text?.startsWith("t${R.string.vm_add_failed}") == true }
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.text)
        bis("frei") { !vm.barcodeState.value.hinzufuegen.laeuft }
    }

    @Test
    fun `aus der Teileliste wird nichts angelegt, nur die Nummer weitergereicht`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.TEILELISTE)
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(Erfassungswunsch("75192-1"))
        assertEquals("75192-1", vm.barcodeState.value.forPartList)
        assertNull(vm.barcodeState.value.result)
        clock.advanceUntilIdle()
        assertTrue(paths.requestsAn("POST /api/v1/sets").isEmpty())
    }

    @Test
    fun `die Texterkennung fragt den Server, zeigt das an und oeffnet ein vorhandenes Set`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertEquals(CheckPhase.BESTAND, vm.entryState.value.check?.phase)
        paths.freigeben()
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertTrue("Ein vorhandenes Set fragt den Katalog nicht", paths.requestsAn("/catalog/").isEmpty())
    }

    @Test
    fun `ein Fehler der Vorabfrage bricht ab, statt zu raten`() {
        paths.codes["/api/v1/sets/exists/10294-1"] = 500
        val vm = vm()
        vm.useScannedSetNumber("10294")
        bis("gemeldet") { t.meldungen.text == "fehler" }
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertNull(vm.barcodeState.value.result)
        assertTrue("Nach einem Fehler wird nicht auf gut Glück weitergefragt", paths.requestsAn("/catalog/").isEmpty())
    }

    @Test
    fun `jeder erfolglose Weg fordert die manuelle Erfassung an`() {
        paths.antworten["/api/v1/sets/barcode/111"] = """{"success":true,"set_number":""}"""
        paths.antworten["/api/v1/sets/exists/10294-1"] = """{"success":true,"exists":false,"set_number":"10294-1"}"""
        paths.antworten["/api/v1/catalog/sets/10294-1"] = """{"success":true}"""
        val vm = vm()
        val routes = listOf<Pair<String, () -> Unit>>(
            "EAN ohne Setnummer" to { vm.resolveBarcode("111") },
            "Texterkennung ohne Katalogeintrag" to { vm.useScannedSetNumber("10294") },
            "Katalogabfrage gescheitert" to {
                paths.codes["/api/v1/catalog/sets/10294-1"] = 500
                vm.useScannedSetNumber("10294")
            },
        )
        for ((name, weg) in routes) {
            vm.manuelleErfassungQuittieren()
            weg()
            bis(name) { vm.barcodeState.value.manuelleErfassungAnfordern }
            bis("$name: Prüfanzeige weg") { vm.entryState.value.check == null }
        }
    }

    @Test
    fun `der Abbruch beendet den Abruf und nicht nur die Anzeige`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        vm.abortCheckAb()
        assertNull(vm.entryState.value.check)
        paths.freigeben()
        clock.advanceUntilIdle()
        assertNull("Der abgebrochene Abruf öffnet hinterher doch noch das Set",
            vm.barcodeState.value.gefundenesSet)
    }

    @Test
    fun `das Abmelden raeumt die Pruefanzeige mit`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        t.sitzung.abgemeldet()
        bis("geräumt") { vm.entryState.value.check == null }
        paths.freigeben()
        clock.advanceUntilIdle()
        assertNull(vm.barcodeState.value.gefundenesSet)
    }
}
