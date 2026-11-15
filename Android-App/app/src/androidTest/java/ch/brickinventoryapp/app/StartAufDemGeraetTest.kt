package ch.brickinventoryapp.app

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Auf einem echten Android (Gradle Managed Device, Job geraetetests): Hilt, Room samt
 * SQLCipher und der Keystore laufen nur dort, Robolectric ersetzt sie. Die App startet
 * ohne Server bis zur ersten Ansicht und stürzt nicht ab.
 *
 * Gegenprobe (lokal nicht messbar, kein Emulator; misst der erste CI-Lauf): in
 * MainActivity.onCreate `error("probe")` → rot „die App startet bis zur ersten Ansicht“.
 */
@RunWith(AndroidJUnit4::class)
class StartAufDemGeraetTest {

    @Test
    fun dieAppStartetBisZurErstenAnsicht() {
        assertEquals("ch.brickinventoryapp", InstrumentationRegistry.getInstrumentation().targetContext.packageName)
        ActivityScenario.launch(MainActivity::class.java).use { szene ->
            szene.moveToState(Lifecycle.State.RESUMED)
            assertEquals(Lifecycle.State.RESUMED, szene.state)
        }
    }
}
