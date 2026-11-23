package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.ScopeFilter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Account and storage location filter lie only in memory; the sign-in resets both.
 *
 * Counter-check (counter-checks/login-keeps-storage-filter.patch): resetAll leaves the
 * lager_ keys standing → red “the sign-in also resets the storage location filter”.
 */
class ScopeFilterStorageTest {

    @Test
    fun `the sign-in also resets the storage location filter`() = runBlocking {
        val memory = ScopeFilterStorage()
        memory.set(ScopeFilter.View.GALLERY, "7")
        memory.setStorage(ScopeFilter.View.GALLERY, "Kiste 3")
        assertEquals("Kiste 3", memory.storageFlow(ScopeFilter.View.GALLERY).first())

        memory.resetAll()

        assertEquals(ScopeFilter.ALL, memory.flow(ScopeFilter.View.GALLERY).first())
        assertEquals("", memory.storageFlow(ScopeFilter.View.GALLERY).first())
    }

    @Test
    fun `an empty storage location removes the filter, separately per view`() = runBlocking {
        val memory = ScopeFilterStorage()
        memory.setStorage(ScopeFilter.View.PARTS, "Regal B")
        memory.setStorage(ScopeFilter.View.GALLERY, "Kiste 3")
        memory.setStorage(ScopeFilter.View.PARTS, " ")

        assertEquals("", memory.storageFlow(ScopeFilter.View.PARTS).first())
        assertEquals("Kiste 3", memory.storageFlow(ScopeFilter.View.GALLERY).first())
    }
}
