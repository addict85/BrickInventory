package ch.brickinventoryapp.uistate

import ch.brickinventoryapp.model.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * An action runs, is finished or failed; what a screen reads from it
 * fits the case, and clearing an error does not stop a running operation.
 *
 * Counter-checks (counter-checks/, :core-model:test):
 *   operation-cleanup-stops  withoutError() always returns Fertig → red “clearing an error …”
 *   operation-ended-without-reason   ended(null) gives a failure → red “ended without a reason …”
 */
class OperationTest {

    private val error = Operation.Failed(Message.Resource(7))

    @Test
    fun `only a running operation runs, only a failed one names a reason`() {
        assertTrue(Operation.Running.running)
        assertFalse(Operation.Done.running)
        assertFalse(error.running)
        assertEquals(Message.Resource(7), error.errorMessage)
        assertNull(Operation.Running.errorMessage)
        assertNull(Operation.Done.errorMessage)
    }

    @Test
    fun `clearing an error does not stop a running operation`() {
        assertEquals(Operation.Done, error.withoutError())
        assertEquals(Operation.Running, Operation.Running.withoutError())
        assertEquals(Operation.Done, Operation.Done.withoutError())
    }

    @Test
    fun `ended without a reason is finished, with a reason failed`() {
        assertEquals(Operation.Done, ended(null))
        assertEquals(error, ended(Message.Resource(7)))
    }
}
