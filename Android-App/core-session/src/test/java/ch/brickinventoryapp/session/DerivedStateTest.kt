package ch.brickinventoryapp.session

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Wer nur einen Teil von AppUiState braucht (die Wurzel der App nur das Design), leitet ihn
 * ab und darf nur dessen Änderungen sehen; sonst rekomponierte jede Änderung der Sitzung
 * die ganze Oberfläche.
 *
 * Gegenprobe: abgeleitet() ohne distinctUntilChanged (gegenproben/abgeleitet-meldet-alles.patch)
 * → rot „a derived state reports only real changes“ ([classic, classic, classic, noppe]).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DerivedStateTest {

    @Test
    fun `a derived state reports only real changes`() = runTest(UnconfinedTestDispatcher()) {
        val zustand = MutableStateFlow(AppUiState())
        val design = zustand.abgeleitet { it.appTheme }
        val gesehen = mutableListOf<Design>()
        val collector = launch { design.collect { gesehen += it } }
        yield()

        for (schritt in listOf<(AppUiState) -> AppUiState>(
            { it.copy(currency = Waehrung("CHF")) }, { it.copy(isAdmin = true) }, { it.copy(appTheme = Design.NOPPE) },
        )) {
            zustand.update(schritt)
            yield()
        }
        collector.cancel()

        assertEquals(listOf(Design.CLASSIC, Design.NOPPE), gesehen)
        assertEquals(Design.NOPPE, design.value)
    }
}
