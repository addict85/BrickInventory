package ch.brickinventoryapp.ui

import androidx.compose.runtime.mutableStateOf
import ch.brickinventoryapp.ui.screens.CameraPermission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Where the button in the camera notice leads: if Android has blocked the question
 * ("don't ask again"), it returns No right away — the button then leads into the
 * app settings. Opening the scanner always only asks the system.
 *
 * Counter-check:
 *   CameraPermission.allow() always asks the system (counter-checks/camera-denied-dead-button.patch)
 *   → red „if the question is blocked, the button leads into the settings“
 */
class CameraPermissionTest {

    private val granted = mutableStateOf(false)
    private val locked = mutableStateOf(false)
    private val routes = mutableListOf<String>()
    private val permission = CameraPermission(granted, locked, { routes += "frage" }) { routes += "einstellungen" }

    @Test
    fun `if the question is blocked, the button leads into the settings`() {
        locked.value = true
        assertTrue(permission.permanentDenied)
        permission.allow()
        assertEquals(listOf("einstellungen"), routes)
    }

    @Test
    fun `otherwise the button asks the system, and opening the scanner never the settings`() {
        permission.allow()
        locked.value = true
        permission.requests()
        assertEquals(listOf("frage", "frage"), routes)
    }

    @Test
    fun `granted nothing is denied, even if the question was blocked once`() {
        locked.value = true
        granted.value = true
        assertFalse(permission.permanentDenied)
    }
}
