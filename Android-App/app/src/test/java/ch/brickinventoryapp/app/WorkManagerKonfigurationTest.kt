package ch.brickinventoryapp.app

import androidx.work.Configuration
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Das Manifest nimmt WorkManagerInitializer heraus (WorkManager fährt auf Abruf hoch, nicht
 * vor onCreate). Dann muss die App selbst die Konfiguration liefern, sonst wirft der erste
 * Zugriff „WorkManager is not initialized properly“ und die Hilt-Worker hätten keine Fabrik.
 *
 * Gegenprobe: BrickInventoryApp ohne Configuration.Provider
 * (gegenproben/app-ohne-workmanager-konfiguration.patch) → rot „die App liefert …“.
 */
class WorkManagerKonfigurationTest {

    @Test
    fun `die App liefert WorkManager seine Konfiguration selbst`() {
        assertTrue("BrickInventoryApp ist kein Configuration.Provider",
            Configuration.Provider::class.java.isAssignableFrom(BrickInventoryApp::class.java))
    }
}
