package ch.brickinventoryapp.management

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import ch.brickinventoryapp.management.ui.screens.PollWhileVisible
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The monitoring poll runs only while the page is visible: in the background it is cancelled,
 * on return it starts again. Driven with a lifecycle of its own.
 *
 * Counter-checks (local, Robolectric):
 *   `repeatOnLifecycle(STARTED) { … }` replaced by a plain `current()` → red (still running in the background)
 *   `Lifecycle.State.STARTED` → `CREATED`                              → red (still running in the background)
 */
@RunWith(RobolectricTestRunner::class)
class PollWhileVisibleTest {

    @get:Rule
    val compose = createComposeRule()

    private class Owner : LifecycleOwner {
        override val lifecycle = LifecycleRegistry.createUnsafe(this)
    }

    @Test
    fun `the monitoring poll hangs on the lifecycle`() {
        val owner = Owner().apply { lifecycle.currentState = Lifecycle.State.RESUMED }
        var starts = 0
        var running = 0
        compose.setContent {
            CompositionLocalProvider(LocalLifecycleOwner provides owner) {
                PollWhileVisible {
                    starts++; running++
                    try { awaitCancellation() } finally { running-- }
                }
            }
        }
        compose.waitForIdle()
        assertEquals("visible: the poll runs", 1 to 1, starts to running)
        compose.runOnIdle { owner.lifecycle.currentState = Lifecycle.State.CREATED }
        compose.waitForIdle()
        assertEquals("in the background the poll is cancelled", 1 to 0, starts to running)
        compose.runOnIdle { owner.lifecycle.currentState = Lifecycle.State.RESUMED }
        compose.waitForIdle()
        assertEquals("back in front it starts again", 2 to 1, starts to running)
    }
}
