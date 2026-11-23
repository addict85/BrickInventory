package ch.brickinventoryapp.app

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On a real Android (Gradle Managed Device, job geraetetests): Hilt, Room including
 * SQLCipher and the keystore only run there, Robolectric replaces them. The app starts
 * without a server up to the first view and does not crash.
 *
 * Counter-check (not measurable locally, no emulator; measured by the first run in CI): in
 * MainActivity.onCreate `error("probe")` → red “the app starts up to the first view”.
 */
@RunWith(AndroidJUnit4::class)
class StartOnTheDeviceTest {

    @Test
    fun theAppStartsUntilToFirstView() {
        // The debug build installs next to the release one (applicationIdSuffix).
        assertEquals("ch.brickinventoryapp.debug", InstrumentationRegistry.getInstrumentation().targetContext.packageName)
        ActivityScenario.launch(MainActivity::class.java).use { scene ->
            scene.moveToState(Lifecycle.State.RESUMED)
            assertEquals(Lifecycle.State.RESUMED, scene.state)
        }
    }
}
