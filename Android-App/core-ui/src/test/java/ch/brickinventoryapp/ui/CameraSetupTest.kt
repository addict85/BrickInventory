package ch.brickinventoryapp.ui

import android.hardware.camera2.CaptureRequest
import android.os.SystemClock
import android.view.MotionEvent
import androidx.camera.core.CameraControl
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.FocusMeteringResult
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.impl.Config as UseCaseConfig
import androidx.camera.core.Preview
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ui.screens.autofocusPermanent
import ch.brickinventoryapp.ui.screens.cameraPreview
import ch.brickinventoryapp.ui.screens.imageAnalyse
import ch.brickinventoryapp.ui.screens.tapToFocus
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The camera setup both scanners share: preview and image analysis both carry continuous
 * autofocus (CameraX merges both into one request), and a tap focuses once at that spot
 * without the camera cancelling it after a few seconds.
 *
 * Counter-check (run here): `.disableAutoCancel()` removed from tapToFocus → red
 * “a tap focuses once at the spot and keeps it” (auto cancel on).
 * Counter-check (run here): `autofocusPermanent(it)` removed from imageAnalyse → red
 * “preview and image analysis carry continuous autofocus” (analysis without AF mode).
 * Counter-check (run here): the `ACTION_UP` condition removed → red “a tap focuses once …”
 * (down and up each focus).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CameraSetupTest {

    private class RecordingControl : CameraControl {
        val actions = mutableListOf<FocusMeteringAction>()
        override fun startFocusAndMetering(action: FocusMeteringAction): ListenableFuture<FocusMeteringResult> {
            actions += action
            return Futures.immediateFuture(FocusMeteringResult.emptyInstance())
        }
        override fun enableTorch(torch: Boolean): ListenableFuture<Void?> = Futures.immediateVoidFuture()
        override fun cancelFocusAndMetering(): ListenableFuture<Void?> = Futures.immediateVoidFuture()
        override fun setZoomRatio(ratio: Float): ListenableFuture<Void?> = Futures.immediateVoidFuture()
        override fun setLinearZoom(linearZoom: Float): ListenableFuture<Void?> = Futures.immediateVoidFuture()
        override fun setExposureCompensationIndex(value: Int): ListenableFuture<Int> = Futures.immediateFuture(value)
    }

    private fun touch(action: Int) =
        MotionEvent.obtain(SystemClock.uptimeMillis(), SystemClock.uptimeMillis(), action, 50f, 50f, 0)

    @Test
    fun `a tap focuses once at the spot and keeps it`() {
        val preview = cameraPreview(ApplicationProvider.getApplicationContext())
        preview.layout(0, 0, 200, 200)
        val control = RecordingControl()
        tapToFocus(preview) { control }
        preview.dispatchTouchEvent(touch(MotionEvent.ACTION_DOWN))
        preview.dispatchTouchEvent(touch(MotionEvent.ACTION_UP))
        assertEquals("focus requests per tap", 1, control.actions.size)
        val action = control.actions.single()
        assertFalse("auto cancel on", action.isAutoCancelEnabled)
        assertEquals("AF points", 1, action.meteringPointsAf.size)
        assertEquals("AE points", 1, action.meteringPointsAe.size)
    }

    @Test
    fun `without a bound camera a tap does nothing`() {
        val preview = cameraPreview(ApplicationProvider.getApplicationContext())
        preview.layout(0, 0, 200, 200)
        tapToFocus(preview) { null }
        preview.dispatchTouchEvent(touch(MotionEvent.ACTION_UP))
    }

    /** The AF mode a use case asks Camera2 for; CameraX names the option after the request key. */
    private fun afMode(config: UseCaseConfig): Any? {
        val option = config.listOptions().singleOrNull { it.id.endsWith(CaptureRequest.CONTROL_AF_MODE.name) } ?: return null
        return config.retrieveOption(option)
    }

    @Test
    fun `preview and image analysis carry continuous autofocus`() {
        val continuous = CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
        assertEquals("analysis", continuous, afMode(imageAnalyse(640, 480).currentConfig))
        assertEquals("preview", continuous, afMode(Preview.Builder().also { autofocusPermanent(it) }.build().currentConfig))
        assertEquals("without the call no AF mode", null, afMode(ImageAnalysis.Builder().build().currentConfig))
    }
}
