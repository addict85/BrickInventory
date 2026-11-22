package ch.brickinventoryapp.session

import ch.brickinventoryapp.model.domain.CurrencyCode
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
 * Whoever needs only part of AppUiState (the app's root only the theme) derives it
 * and may only see its changes; otherwise every change to the session would recompose
 * the whole UI.
 *
 * Counter-check: derived() without distinctUntilChanged (counter-checks/abgeleitet-meldet-alles.patch)
 * → red „a derived state reports only real changes“ ([classic, classic, classic, noppe]).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DerivedStateTest {

    @Test
    fun `a derived state reports only real changes`() = runTest(UnconfinedTestDispatcher()) {
        val condition = MutableStateFlow(AppUiState())
        val design = condition.derived { it.appTheme }
        val seen = mutableListOf<Design>()
        val collector = launch { design.collect { seen += it } }
        yield()

        for (step in listOf<(AppUiState) -> AppUiState>(
            { it.copy(currency = CurrencyCode("CHF")) }, { it.copy(isAdmin = true) }, { it.copy(appTheme = Design.STUD) },
        )) {
            condition.update(step)
            yield()
        }
        collector.cancel()

        assertEquals(listOf(Design.CLASSIC, Design.STUD), seen)
        assertEquals(Design.STUD, design.value)
    }
}
