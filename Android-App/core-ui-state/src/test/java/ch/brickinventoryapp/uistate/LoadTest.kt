package ch.brickinventoryapp.uistate

import ch.brickinventoryapp.model.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Loading, data and error exclude each other; what a screen reads from it
 * fits the case.
 *
 * Counter-checks (measured 14.11.2026, :core-model:test):
 *   A  `offline` delivers `state == null` → red “data from the store is offline …”
 *   B  dataOrNull() returns a value even on error (`as? Load.Data<T>` replaced by
 *      default) → red “only data carries a value”
 */
class LoadTest {

    private val error = Load.Failure(ErrorClass.OFFLINE, Message.Resource(7))

    @Test
    fun `data from the store is offline, fresh data is not`() {
        assertTrue(Load.Data(listOf(1), state = 1000L).offline)
        assertFalse(Load.Data(listOf(1)).offline)
    }

    @Test
    fun `only data carries a value`() {
        assertEquals(listOf(1), Load.Data(listOf(1)).dataOrNull())
        assertNull((Load.Loads as Load<List<Int>>).dataOrNull())
        assertNull((error as Load<List<Int>>).dataOrNull())
    }

    @Test
    fun `loading and error say what they are`() {
        assertTrue(Load.Loads.loading)
        assertFalse(error.loading)
        assertEquals(Message.Resource(7), error.errorMessage)
        assertEquals(ErrorClass.OFFLINE, error.errorKind)
        assertNull(Load.Data(Unit).errorMessage)
        assertNull(Load.Loads.errorKind)
    }
}
