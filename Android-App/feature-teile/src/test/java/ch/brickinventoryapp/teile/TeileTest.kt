package ch.brickinventoryapp.teile

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.Farbwahl
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.teile.ui.Figuren
import ch.brickinventoryapp.teile.ui.FigurenLokal
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.teile.ui.TeileLokal
import ch.brickinventoryapp.teile.ui.TeileUiState
import ch.brickinventoryapp.teile.ui.TeileQuelle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht

/**
 * Teile- und Figurenliste als Ablauf geprüft. Ihre Quellen sind Flüsse (im Gerät
 * die Ablage oder die Kontosicht, das wählt das ViewModel); der Abruf füllt nur
 * die Quelle und schreibt hier mit, für welchen Zustand er gerufen wurde.
 *
 * Gegenproben (kotlinc gegen Teile.kt, Fassung mit einem Lademodus):
 *   A  in ladeTeile() den Zustand vor dem Entprellen gelesen → rot „die Filter des
 *      Zustands erreichen Quelle und Abruf“ (Suche fehlt)
 *   B  vergissScroll() in setzeFilter() entfernt → rot „ein Filterwechsel vergisst
 *      die Scrollstelle“
 *   C  die Figurenkennzahlen in denselben Auftrag wie die Liste gelegt → rot „die
 *      Figurenliste wartet nicht auf die Kennzahlen“
 *   D  in Listenfolge.abbrechen() `folgen.forEach { it.cancel() }` entfernt → rot „nach
 *      einem Filterwechsel schreibt die alte Quelle nicht mehr hinein“
 *   E  in ausgang() den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz
 *      bleiben die Figuren stehen“
 *   F  in folge() die Prüfung auf den Stand entfernt → rot „eine nie geladene
 *      Quelle zeigt nichts und leert nichts“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileTest {

    private class Kennzahlen : TeileQuelle {
        var figurAbrufe = 0
        var figurDauer = 0L
        override suspend fun teileKennzahlen(): Ergebnis<TeileKennzahlenAnsicht?> = Ergebnis.Fehler.Server(503, "aus")
        override suspend fun filterFarben() = Ergebnis.Erfolg(emptyList<FilterFarbeAnsicht>())
        override suspend fun kategorien() = Ergebnis.Erfolg(emptyList<KategorieAnsicht>())
        override suspend fun alleFarben() = Ergebnis.Erfolg(emptyList<FarbeAnsicht>())
        suspend fun figurKennzahlen(): Ergebnis<FigurenKennzahlenAnsicht> {
            figurAbrufe++
            delay(figurDauer)
            return Ergebnis.Fehler.Server(500, "Zählung gescheitert")
        }
    }

    private val kennzahlen = Kennzahlen()
    private val teile = MutableStateFlow(Lokal(listOf(TeilAnsicht(partNumber = "3001", partName = "Brick", colorName = "Red"),
        TeilAnsicht(partNumber = "3023", partName = "Plate", colorName = "Blue")), 1L))
    private val manuelleTeile = MutableStateFlow(Lokal(emptyList<ManuellesTeilAnsicht>(), 1L))
    private val figuren = MutableStateFlow(Lokal(listOf(FigurAnsicht(figNumber = "sw0001")), 4L))
    private val manuelleFiguren = MutableStateFlow(Lokal(emptyList<ManuelleFigurAnsicht>(), 4L))
    private val teileAbrufe = mutableListOf<TeileUiState>()
    private val manuelleSuchen = mutableListOf<String>()
    private val figurAbrufe = mutableListOf<String>()
    private var figurenAntwort: Ergebnis<Unit> = Ergebnis.Erfolg(Unit)
    private var vergessen = 0

    /**
     * Im Vordergrund des Takts, damit advanceUntilIdle auch die Abrufe abwartet
     * (backgroundScope zählt dort nicht); als Kind des Hintergrunds endet er mit dem Test.
     */
    private fun TestScope.vordergrund() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    // Wie die Filterspalten in Room: Der Suchtext trifft Nummer oder Name, die Farbe den Farbnamen.
    private fun TestScope.teile() = Teile(
        scope = vordergrund(), quelle = kennzahlen, meldeFehler = {}, vergissScroll = { vergessen++ },
        listen = TeileLokal(
            teile = { st -> val f = st.filter; teile.map { l -> l.copy(liste = l.liste.filter {
                (f.suche.isBlank() || it.partNumber.contains(f.suche) || it.partName.orEmpty().contains(f.suche)) &&
                    (f.farbe == Farbwahl.Alle || it.colorName == f.farbe.wert) }) } },
            manuelleTeile = { st -> manuelleSuchen += st.filter.suche; manuelleTeile },
            aktualisiere = { st -> teileAbrufe += st; Ergebnis.Erfolg(Unit) },
        ),
    )

    private fun TestScope.figurenliste() = Figuren(
        scope = vordergrund(), meldeFehler = {},
        listen = FigurenLokal(
            figuren = { figuren },
            manuelleFiguren = { manuelleFiguren },
            aktualisiere = { st -> figurAbrufe += st.minifigsQuery; figurenAntwort },
            kennzahlen = { kennzahlen.figurKennzahlen() },
        ),
    )

    private fun Teile.filtere(aenderung: (Teilefilter) -> Teilefilter) = setzeFilter(aenderung(state.value.filter))

    @Test
    fun `die Filter des Zustands erreichen Quelle und Abruf`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = Farbwahl.Farbe("Red")) }; t.filtere { it.copy(kategorie = Kategoriewahl.Kategorie("11")) }
        t.filtere { it.copy(ersatz = Ersatzteilwahl.OHNE) }; t.filtere { it.copy(ansicht = Listenansicht.TABELLE) }
        t.filtere { it.copy(suche = "30") }
        advanceUntilIdle()
        val st = teileAbrufe.last().filter
        assertEquals(listOf("30", "Red", "11"), listOf(st.suche, st.farbe.wert, st.kategorie.wert))
        assertEquals(Ersatzteilwahl.OHNE to Listenansicht.TABELLE, st.ersatz to st.ansicht)
        assertEquals(listOf("3001"), t.state.value.parts.map { it.partNumber })
        assertEquals("die manuellen Teile unter demselben Suchtext", "30", manuelleSuchen.last())
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = Farbwahl.Farbe("5")) }; t.filtere { it.copy(kategorie = Kategoriewahl.Kategorie("11")) }
        t.filtere { it.copy(ersatz = Ersatzteilwahl.NUR) }; t.filtere { it.copy(suche = "stein") }
        assertEquals(4, vergessen)
        t.filtere { it.copy(farbe = Farbwahl.Farbe("5")) }
        assertEquals("Dieselbe Farbe noch einmal ist kein Wechsel", 4, vergessen)
        advanceUntilIdle()
    }

    @Test
    fun `die Liste folgt der Quelle, auch ohne Abruf`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        // Vorgabe ist „nach Farbe“ (TeileOrdnung): Blue vor Red, nicht die Reihenfolge der Quelle.
        assertEquals(listOf("3023", "3001"), t.state.value.parts.map { it.partNumber })
        // Offline erfasst: Die Ablage ändert sich, die Liste folgt.
        manuelleTeile.value = Lokal(listOf(ManuellesTeilAnsicht(partNumber = "neu", quantity = 3)), 2L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })
        t.laden(seite = 2); runCurrent()
        assertEquals("geblättert wird nicht mehr: Die Quelle hält alles", 1, teileAbrufe.size)
    }

    @Test
    fun `nach einem Filterwechsel schreibt die alte Quelle nicht mehr hinein`() = runTest {
        val alt = MutableStateFlow(Lokal(listOf(TeilAnsicht(partNumber = "alt")), 1L))
        val neu = MutableStateFlow(Lokal(listOf(TeilAnsicht(partNumber = "neu")), 1L))
        val t = Teile(scope = vordergrund(), quelle = kennzahlen, meldeFehler = {}, vergissScroll = {},
            listen = TeileLokal(teile = { st -> if (st.filter.farbe == Farbwahl.Alle) alt else neu },
                manuelleTeile = { manuelleTeile }, aktualisiere = { Ergebnis.Erfolg(Unit) }))
        t.laden(); runCurrent()
        t.filtere { it.copy(farbe = Farbwahl.Farbe("Red")) }; runCurrent()
        alt.value = Lokal(listOf(TeilAnsicht(partNumber = "spaet")), 2L)
        runCurrent()
        assertEquals(listOf("neu"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `die Figurenliste wartet nicht auf die Kennzahlen und ein Fehlschlag laesst sie stehen`() = runTest {
        kennzahlen.figurDauer = 5_000
        val t = figurenliste()
        t.laden()
        advanceTimeBy(10); runCurrent()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertFalse(t.zustand.value.figurenAbruf.laedt)
        advanceUntilIdle()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertEquals(FigurenKennzahlenAnsicht(), t.zustand.value.minifigStats)
    }

    @Test
    fun `beim Tippen fragt die Figurenliste einmal und zaehlt nicht neu`() = runTest {
        val t = figurenliste()
        t.setzeSuche("lu"); t.setzeSuche("luk"); t.setzeSuche("luke")
        advanceUntilIdle()
        assertEquals(listOf("luke"), figurAbrufe)
        assertEquals(0, kennzahlen.figurAbrufe)
    }

    @Test
    fun `ohne Netz bleiben die Figuren stehen, mit ihrem Stand`() = runTest {
        figurenAntwort = Ergebnis.Fehler.Netz()
        val t = figurenliste()
        t.laden(); runCurrent()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertNull("ohne Netz bleiben die Figuren stehen", t.zustand.value.figurenAbruf.fehlerMeldung)
        assertEquals(4L, t.zustand.value.figurenOfflineStand)
    }

    @Test
    fun `eine nie geladene Quelle zeigt nichts und leert nichts`() = runTest {
        figuren.value = Lokal(listOf(FigurAnsicht(figNumber = "alt")), null)
        val t = figurenliste()
        t.laden(); runCurrent()
        assertEquals(emptyList<String>(), t.zustand.value.minifigs.map { it.figNumber })
        figuren.value = Lokal(listOf(FigurAnsicht(figNumber = "sw0002")), 5L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.zustand.value.minifigs.map { it.figNumber })
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = Farbwahl.Farbe("Red")) }; runCurrent()
        t.zuruecksetzen()
        advanceUntilIdle()
        assertEquals(TeileUiState(), t.state.value)
    }
}
