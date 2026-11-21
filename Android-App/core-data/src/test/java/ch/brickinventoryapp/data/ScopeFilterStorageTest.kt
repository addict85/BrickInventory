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
class ScopeFilterStorageTest {

    @Test
    fun `the sign-in also resets the storage location filter`() = runBlocking {
        val speicher = ScopeFilterStorage()
        speicher.set(ScopeFilter.View.GALLERY, "7")
        speicher.setLager(ScopeFilter.View.GALLERY, "Kiste 3")
        assertEquals("Kiste 3", speicher.storageFlow(ScopeFilter.View.GALLERY).first())

        speicher.resetAll()

        assertEquals(ScopeFilter.ALL, speicher.flow(ScopeFilter.View.GALLERY).first())
        assertEquals("", speicher.storageFlow(ScopeFilter.View.GALLERY).first())
    }

    @Test
    fun `an empty storage location removes the filter, separately per view`() = runBlocking {
        val speicher = ScopeFilterStorage()
        speicher.setLager(ScopeFilter.View.PARTS, "Regal B")
        speicher.setLager(ScopeFilter.View.GALLERY, "Kiste 3")
        speicher.setLager(ScopeFilter.View.PARTS, " ")

        assertEquals("", speicher.storageFlow(ScopeFilter.View.PARTS).first())
        assertEquals("Kiste 3", speicher.storageFlow(ScopeFilter.View.GALLERY).first())
    }
}
