package ch.brickinventoryapp

import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.model.AddSetResponse
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Pruefphase
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.ui.viewmodel.Texte
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Das Erfassungs-ViewModel: Scan, Erfassen über die Setnummer, Prüfanzeige.
 * Der Ereignisstrom des Anlegens ist nachgebaut ([SetAnleger]), alles andere
 * läuft gegen einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen ErfassungViewModel.kt):
 *   A  in zeigeVorhandenes() `exists` ignoriert (immer false) → rot „ein
 *      gescanntes Set, das schon da ist, wird geöffnet …“
 *   B  das `finally` in resolveBarcode() entfernt → rot „ein erfolgloser Scan
 *      öffnet die manuelle Erfassung …“ (die Prüfanzeige bleibt stehen)
 *   C  beim Anlegen den Stammdaten-Schritt nicht angezeigt → rot „das Anlegen
 *      zeigt die Schritte des Servers …“
 *   D  einen leeren Fehler als Satz des Servers gewertet → rot „ein
 *      abgebrochener Ereignisstrom ist ein Netzfehler …“
 *   E  in confirmAddBarcode() die Sperre `if (stand.adding) return` entfernt →
 *      rot „ein zweiter Klick auf Bestätigen …“; ebenso, wenn der Dialog erst
 *      nach der Antwort schliesst oder der Eigentümer nicht mitgeht
 *   F  `adding = false` nach der Antwort entfernt → rot „ein Fehlschlag beim
 *      Bestätigen …“ und „ein zweiter Klick …“
 *   G  im Teilelisten-Zweig das `return` entfernt → rot „aus der Teileliste
 *      wird nichts angelegt …“
 *   H  in useScannedSetNumber() die Vorabfrage übersprungen → rot „die
 *      Texterkennung fragt den Server …“ und „ein Fehler der Vorabfrage …“
 *   I  in zeigeVorhandenes() bei einem Fehler weitergemacht → rot „ein Fehler
 *      der Vorabfrage bricht ab …“
 *   J  bei gescheiterter Katalogabfrage keine manuelle Erfassung → rot „jeder
 *      erfolglose Weg …“
 *   K  in brichPruefungAb() den Job nicht abgebrochen → rot „der Abbruch …“
 *      und „das Abmelden …“
 *   L  in zuruecksetzen() die Prüfung nicht abgebrochen → rot „das Abmelden
 *      räumt die Prüfanzeige mit“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ErfassungViewModelTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    /** Wie NummernTexte, aber mit den Argumenten — der Test prüft auch, WAS eingesetzt wurde. */
    private object TexteMitArgumenten : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id" + args.joinToString("") { "|$it" }
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: ch.brickinventoryapp.data.repository.Result.Error) = "fehler"
        override fun angemeldet() = true
    }

    /** Spielt die Schritte ab und schreibt die Prüfphasen mit, die dabei zu sehen waren. */
    private class Anleger(val schritte: List<SetAnlegenSchritt>) : SetAnleger {
        var vm: ErfassungViewModel? = null
        val gesehen = mutableListOf<Pruefphase?>()
        override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                             ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = flow {
            for (s in schritte) {
                emit(s)
                gesehen += vm?.erfassungState?.value?.pruefung?.phase
            }
        }
    }

    private fun vm(anleger: Anleger = Anleger(emptyList())) = t.merke(
        ErfassungViewModel(t.dienste, SetsRepository(t.api, t.cache), AdminRepository(t.api, t.cache), anleger)
    ).also { anleger.vm = it }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer(
            "/api/v1/sets/barcode/5702016616316" to """{"success":true,"set_number":"75192-1","name":"Falke"}""",
            "/api/v1/sets/exists/75192-1" to """{"success":true,"exists":true,"set_number":"75192-1"}""",
            "/api/v1/wanted" to """{"success":true,"war_neu":true}""",
        )
        t = TestDienste(pfade.server, TexteMitArgumenten)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `ein gescanntes Set, das schon da ist, wird geoeffnet statt erfasst`() {
        val vm = vm()
        vm.setScannerSource("gallery_search")
        vm.resolveBarcode("5702016616316")
        TestApi.warteBis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        assertNull("Kein Bestätigungsdialog", vm.barcodeState.value.result)
        TestApi.warteBis("Prüfanzeige weg") { vm.erfassungState.value.pruefung == null }
    }

    @Test
    fun `ein erfolgloser Scan oeffnet die manuelle Erfassung und raeumt die Pruefanzeige`() {
        val vm = vm()
        vm.resolveBarcode("0000")
        TestApi.warteBis("manuell") { vm.barcodeState.value.manuelleErfassungAnfordern }
        assertEquals("t${R.string.vm_barcode_not_found}|0000", t.meldungen.meldung.value)
        TestApi.warteBis("Prüfanzeige weg") { vm.erfassungState.value.pruefung == null }
    }

    @Test
    fun `das Anlegen zeigt die Schritte des Servers und meldet das neue Set`() {
        val anleger = Anleger(listOf(
            SetAnlegenSchritt.Stammdaten("Falke"), SetAnlegenSchritt.Bild, SetAnlegenSchritt.FastFertig,
            SetAnlegenSchritt.Fertig(AddSetResponse(action = "added", setNumber = "75192-1")),
        ))
        val vm = vm(anleger)
        val liste = t.gemeldet(1) {
            vm.addSet("75192")
            TestApi.warteBis("fertig") { vm.erfassungState.value.pruefung == null && t.meldungen.meldung.value != null }
        }
        assertEquals(listOf(Pruefphase.ANLEGEN_STAMMDATEN, Pruefphase.ANLEGEN_BILD, Pruefphase.ANLEGEN_ABSCHLUSS),
            anleger.gesehen.take(3))
        assertEquals("t${R.string.vm_added}|75192-1", t.meldungen.meldung.value)
        assertEquals(listOf(Aenderung.Sets), liste)
    }

    @Test
    fun `ein vorhandenes Set beim Anlegen oeffnet die Detailansicht und meldet nichts`() {
        val vm = vm(Anleger(listOf(SetAnlegenSchritt.Fertig(AddSetResponse(action = "exists", setNumber = "75192-1")))))
        val liste = t.gemeldet(0) {
            vm.addSet("75192-1")
            TestApi.warteBis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        }
        assertTrue(liste.isEmpty())
    }

    @Test
    fun `ein abgebrochener Ereignisstrom ist ein Netzfehler, kein Satz des Servers`() {
        val vm = vm(Anleger(listOf(SetAnlegenSchritt.Fehler(""))))
        vm.addSet("75192-1")
        TestApi.warteBis("gemeldet") { t.meldungen.meldung.value != null }
        // Ein Netzfehler wird über meldung() formuliert ("fehler"); ein Satz
        // des Servers käme unverändert — hier leer — und sagte nichts.
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.meldung.value)
    }

    @Test
    fun `ein Scan aus der Merkliste legt einen Merkposten an und schliesst den Dialog`() {
        val vm = vm()
        vm.setScannerSource("wanted")
        val liste = t.gemeldet(1) {
            vm.confirmAddBarcode("10294-1", condition = "U")
            TestApi.warteBis("gemeldet") { t.meldungen.meldung.value != null }
        }
        assertEquals(listOf(Aenderung.Merkliste), liste)
        assertEquals("t${R.string.wanted_added}", t.meldungen.meldung.value)
        assertTrue(pfade.anfragenAn("POST /api/v1/wanted").isNotEmpty())
        assertNull(vm.barcodeState.value.result)
    }

    /** Ein Scan bis zum Bestätigungsdialog (Quelle Galerie, also ohne Vorabfrage). */
    private fun bisZumDialog(): ErfassungViewModel {
        val vm = vm()
        vm.resolveBarcode("5702016616316")
        TestApi.warteBis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        return vm
    }

    @Test
    fun `ein zweiter Klick auf Bestaetigen legt das Set nicht zweimal an`() {
        pfade.antworten["/api/v1/sets"] = """{"success":true,"action":"added","set_number":"75192-1"}"""
        pfade.verzoegert["/api/v1/sets"] = 300
        val vm = bisZumDialog()
        val liste = t.gemeldet(1) {
            vm.confirmAddBarcode("75192-1", ownerUserId = 2)
            // Der Dialog schliesst sofort, und angelegt wird im Hintergrund — ohne Prüfanzeige.
            assertNull(vm.barcodeState.value.result)
            assertTrue(vm.barcodeState.value.adding)
            assertNull(vm.erfassungState.value.pruefung)
            vm.confirmAddBarcode("75192-1", ownerUserId = 2)
            TestApi.warteBis("fertig") { !vm.barcodeState.value.adding }
        }
        assertEquals(listOf(Aenderung.Sets), liste)
        assertEquals(1, pfade.anfragenAn("POST /api/v1/sets").size)
        val rumpf = pfade.koerper[pfade.anfragen.indexOf("POST /api/v1/sets")]
        assertTrue(rumpf, "\"owner_user_id\":2" in rumpf)
    }

    @Test
    fun `ein Fehlschlag beim Bestaetigen nennt die Setnummer und gibt den Knopf frei`() {
        pfade.codes["/api/v1/sets"] = 500
        val vm = bisZumDialog()
        vm.confirmAddBarcode("75192-1")
        TestApi.warteBis("gemeldet") { t.meldungen.meldung.value?.startsWith("t${R.string.vm_add_failed}") == true }
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.meldung.value)
        TestApi.warteBis("frei") { !vm.barcodeState.value.adding }
    }

    @Test
    fun `aus der Teileliste wird nichts angelegt, nur die Nummer weitergereicht`() {
        val vm = vm()
        vm.setScannerSource("partslist")
        vm.resolveBarcode("5702016616316")
        TestApi.warteBis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode("75192-1")
        assertEquals("75192-1", vm.barcodeState.value.fuerTeileliste)
        assertNull(vm.barcodeState.value.result)
        Thread.sleep(200)
        assertTrue(pfade.anfragenAn("POST /api/v1/sets").isEmpty())
    }

    @Test
    fun `die Texterkennung fragt den Server, zeigt das an und oeffnet ein vorhandenes Set`() {
        pfade.verzoegert["/api/v1/sets/exists/75192-1"] = 300
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertEquals(Pruefphase.BESTAND, vm.erfassungState.value.pruefung?.phase)
        TestApi.warteBis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        TestApi.warteBis("Prüfanzeige weg") { vm.erfassungState.value.pruefung == null }
        assertTrue("Ein vorhandenes Set fragt den Katalog nicht", pfade.anfragenAn("/catalog/").isEmpty())
    }

    @Test
    fun `ein Fehler der Vorabfrage bricht ab, statt zu raten`() {
        pfade.codes["/api/v1/sets/exists/10294-1"] = 500
        val vm = vm()
        vm.useScannedSetNumber("10294")
        TestApi.warteBis("gemeldet") { t.meldungen.meldung.value == "fehler" }
        TestApi.warteBis("Prüfanzeige weg") { vm.erfassungState.value.pruefung == null }
        assertNull(vm.barcodeState.value.result)
        assertTrue("Nach einem Fehler wird nicht auf gut Glück weitergefragt", pfade.anfragenAn("/catalog/").isEmpty())
    }

    @Test
    fun `jeder erfolglose Weg fordert die manuelle Erfassung an`() {
        pfade.antworten["/api/v1/sets/barcode/111"] = """{"success":true,"set_number":""}"""
        pfade.antworten["/api/v1/sets/exists/10294-1"] = """{"success":true,"exists":false,"set_number":"10294-1"}"""
        pfade.antworten["/api/v1/catalog/sets/10294-1"] = """{"success":true}"""
        val vm = vm()
        val wege = listOf<Pair<String, () -> Unit>>(
            "EAN ohne Setnummer" to { vm.resolveBarcode("111") },
            "Texterkennung ohne Katalogeintrag" to { vm.useScannedSetNumber("10294") },
            "Katalogabfrage gescheitert" to {
                pfade.codes["/api/v1/catalog/sets/10294-1"] = 500
                vm.useScannedSetNumber("10294")
            },
        )
        for ((name, weg) in wege) {
            vm.manuelleErfassungQuittieren()
            weg()
            TestApi.warteBis(name) { vm.barcodeState.value.manuelleErfassungAnfordern }
            TestApi.warteBis("$name: Prüfanzeige weg") { vm.erfassungState.value.pruefung == null }
        }
    }

    @Test
    fun `der Abbruch beendet den Abruf und nicht nur die Anzeige`() {
        pfade.verzoegert["/api/v1/sets/exists/75192-1"] = 400
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.erfassungState.value.pruefung != null)
        vm.brichPruefungAb()
        assertNull(vm.erfassungState.value.pruefung)
        Thread.sleep(700)
        assertNull("Der abgebrochene Abruf öffnet hinterher doch noch das Set",
            vm.barcodeState.value.gefundenesSet)
    }

    @Test
    fun `das Abmelden raeumt die Pruefanzeige mit`() {
        pfade.verzoegert["/api/v1/sets/exists/75192-1"] = 400
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.erfassungState.value.pruefung != null)
        t.sitzung.abgemeldet()
        TestApi.warteBis("geräumt") { vm.erfassungState.value.pruefung == null }
        Thread.sleep(700)
        assertNull(vm.barcodeState.value.gefundenesSet)
    }
}
