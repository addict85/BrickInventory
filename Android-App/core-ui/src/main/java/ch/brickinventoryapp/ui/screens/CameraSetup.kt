package ch.brickinventoryapp.ui.screens

import android.hardware.camera2.CaptureRequest
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy

/**
 * The camera setup shared by both scanners (barcode scanner and SetupScreen).
 * One file, because two implementations of a rule each look right on their own and
 * only stand out once one of them is changed — then the other keeps working silently, unchanged.
 */

/**
 * An image analysis with the settings that apply to both scanners.
 * The AF mode lives here too, not only on the preview: CameraX merges both into one request,
 * and depending on the device, the analysis has a say too.
 */
fun imageAnalyse(width: Int, height: Int): ImageAnalysis =
    ImageAnalysis.Builder()
        .also { autofocusPermanent(it) }
        .setResolutionSelector(
            ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        android.util.Size(width, height),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                ).build()
        )
        // Only the newest frame: a backlog here would be delay, not a gain —
        // a barcode from two seconds ago interests nobody anymore.
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        // YUV, because ML Kit works with it directly; RGBA would mean a conversion per frame.
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        .build()

/**
 * Force continuous autofocus on a use case. A one-time
 * focus trigger at startup is unreliable depending on the device; CONTINUOUS_PICTURE
 * keeps refocusing on its own. One function for both use cases, so the mode on
 * both is the same line.
 */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
fun autofocusPermanent(builder: ImageAnalysis.Builder) {
    Camera2Interop.Extender(builder).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/** The same for the preview — see [autofocusPermanent]. */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
fun autofocusPermanent(builder: Preview.Builder) {
    Camera2Interop.Extender(builder).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/**
 * Bind preview and image analysis to the lifecycle — for both scanners. The `try` wraps
 * the whole callback, because `future.get()` has thrown since CameraX 1.4 when the camera is busy;
 * `unbindAll()` beforehand, otherwise an earlier binding lingers.
 */
fun cameraBind(
    ctx: Context,
    previewView: PreviewView,
    lifecycleOwner: LifecycleOwner,
    analyse: ImageAnalysis,
    atError: () -> Unit = {},
    atCamera: (Camera) -> Unit,
) {
    val future = ProcessCameraProvider.getInstance(ctx)
    future.addListener({
        // See rule 1 above: the try wraps the ENTIRE callback.
        try {
            val provider = future.get()
            val previewBuilder = Preview.Builder()
            autofocusPermanent(previewBuilder)
            val preview = previewBuilder.build()
                .also { it.setSurfaceProvider(previewView.surfaceProvider) }
            try {
                provider.unbindAll()
                atCamera(
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analyse
                    )
                )
            } catch (_: Exception) {
                // Deliberately silent: binding practically only fails when the lifecycle has already
                // ended — then there's nobody left to report anything to.
                // atError() belongs in the outer case, where the camera isn't available at
                // all in the first place.
            }
        } catch (_: Exception) {
            // Camera not available (busy, hardware error). What follows
            // from that is decided by the caller: the scanner shows a hint
            // instead of a black image, SetupScreen deliberately leaves the preview
            // empty.
            atError()
        }
    }, ContextCompat.getMainExecutor(ctx))
}

/** The preview of both scanners: fills the area and computes fast rather than compatibly. */
fun cameraPreview(ctx: Context): PreviewView = PreviewView(ctx).apply {
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.PERFORMANCE
}

/**
 * Tapping focuses at that spot and meters exposure there: with instructions
 * held close to the lens, continuous autofocus likes to miss. disableAutoCancel(),
 * otherwise the camera would fall back to its own choice after a few seconds. [control] is null
 * as long as the camera isn't bound.
 */
fun tapToFocus(previewView: PreviewView, control: () -> CameraControl?) {
    previewView.setOnTouchListener { v, ev ->
        if (ev.action == MotionEvent.ACTION_UP) {
            val point = previewView.meteringPointFactory.createPoint(ev.x, ev.y)
            val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                .addPoint(point, FocusMeteringAction.FLAG_AE)
                .disableAutoCancel()
                .build()
            // Camera not ready yet or already gone: the tap has no effect.
            runCatching { control()?.startFocusAndMetering(action) }
            v.performClick()
        }
        true
    }
}
