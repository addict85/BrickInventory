package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.ScopeFilter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Konto- und Lagerortfilter liegen nur im Speicher; die Anmeldung setzt beide zurück.
 *
 * Gegenprobe (gegenproben/anmeldung-behaelt-lagerfilter.patch): resetAll lässt die
 * lager_-Schlüssel stehen → rot „die Anmeldung setzt auch den Lagerortfilter zurück“.
 */
class ScopeFilterSpeicherTest {

    @Test
    fun `die Anmeldung setzt auch den Lagerortfilter zurueck`() = runBlocking {
        val speicher = ScopeFilterSpeicher()
        speicher.set(ScopeFilter.View.GALLERY, "7")
        speicher.setLager(ScopeFilter.View.GALLERY, "Kiste 3")
        assertEquals("Kiste 3", speicher.lagerFlow(ScopeFilter.View.GALLERY).first())

        speicher.resetAll()

        assertEquals(ScopeFilter.ALL, speicher.flow(ScopeFilter.View.GALLERY).first())
        assertEquals("", speicher.lagerFlow(ScopeFilter.View.GALLERY).first())
    }

    @Test
    fun `ein leerer Lagerort hebt den Filter auf, je Ansicht getrennt`() = runBlocking {
        val speicher = ScopeFilterSpeicher()
        speicher.setLager(ScopeFilter.View.PARTS, "Regal B")
        speicher.setLager(ScopeFilter.View.GALLERY, "Kiste 3")
        speicher.setLager(ScopeFilter.View.PARTS, " ")

        assertEquals("", speicher.lagerFlow(ScopeFilter.View.PARTS).first())
        assertEquals("Kiste 3", speicher.lagerFlow(ScopeFilter.View.GALLERY).first())
    }
}
