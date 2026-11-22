package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The server's design is remembered, and twice: in the DataStore and in a
 * synchronously readable mirror, so that already the first frame of a cold start arises in the right
 * design. That an empty or unknown value deletes nothing is held by the type
 * (DesignOrNothing, DomainTypesTest). Under Robolectric with a real store.
 *
 * Counter-check (patch under counter-checks/, Robolectric, measured by CI):
 *   design-ohne-spiegel   saveAppTheme does not write the mirror → red “the remembered design …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DesignStoreTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()

    private fun store() = DevicesStore(ctx,
        PreferenceDataStoreFactory.create { File(ctx.filesDir, "design-${System.nanoTime()}.preferences_pb") },
        testTrustCipher())

    @Test
    fun `the remembered design is there immediately on the next start`() = runBlocking {
        val now = store()
        assertEquals("Ohne Eintrag gilt der Standard", Design.CLASSIC, now.rememberedDesign())
        now.saveAppTheme(Design.BRICK)
        assertEquals(Design.BRICK, now.appTheme.first())
        // A new start whose DataStore has not delivered anything yet: only the mirror counts.
        assertEquals(Design.BRICK, store().rememberedDesign())
    }
}
