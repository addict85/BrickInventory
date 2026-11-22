package ch.brickinventoryapp.app

import androidx.work.Configuration
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The manifest removes WorkManagerInitializer (WorkManager starts on demand, not
 * before onCreate). Then the app must supply the configuration itself, otherwise the first
 * access throws „WorkManager is not initialized properly“ and the Hilt workers would have no factory.
 *
 * Counter-check: BrickInventoryApp without Configuration.Provider
 * (counter-checks/app-ohne-workmanager-konfiguration.patch) → red “the app supplies …”.
 */
class WorkManagerConfigurationTest {

    @Test
    fun `the app supplies WorkManager its configuration itself`() {
        assertTrue("BrickInventoryApp ist kein Configuration.Provider",
            Configuration.Provider::class.java.isAssignableFrom(BrickInventoryApp::class.java))
    }
}
