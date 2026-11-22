package ch.brickinventoryapp.session

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The token doesn't live in the shared UI state: every screen reads that, but the
 * token is only needed by the interceptor. Checked against the compiled class.
 *
 * Counter-check: field `authToken`
 * back in AppUiState → red „no field of AppUiState carries a token“.
 */
class NoTokenInStateTest {

    @Test
    fun `no field of AppUiState carries a token`() {
        val felder = AppUiState::class.java.declaredFields.map { it.name }
        assertEquals(emptyList<String>(), felder.filter { it.contains("token", ignoreCase = true) })
    }
}
