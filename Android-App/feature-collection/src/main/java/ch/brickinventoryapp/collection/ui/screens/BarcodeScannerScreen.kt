package ch.brickinventoryapp.collection.ui.screens

/*
 * Autofocus: CONTINUOUS_PICTURE on preview AND image analysis, because CameraX merges both into one request;
 * no periodic refocusing, which would keep making the camera re-measure.
 */

import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.*
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashlightOff
import androidx.compose.material.icons.filled.FlashlightOn
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.screens.CameraOverlay
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.ui.screens.cameraBind
import ch.brickinventoryapp.ui.screens.cameraPreview
import ch.brickinventoryapp.ui.screens.rememberCameraPermission
import ch.brickinventoryapp.ui.screens.tapToFocus
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

@Composable
fun BarcodeScannerScreen(
    onResult: (String) -> Unit,
    /**
     * Text recognition in addition to the barcode, only when entering sets and in the
     * parts list. Off by default: in the price comparison a merely probably correct
     * number is a risk, and every future caller should turn it on deliberately.
     */
    ocrEnabled: Boolean = false,
    /** SET NUMBER read via text recognition — only relevant if ocrEnabled. */
    onSetNumberResult: (String) -> Unit = onResult,
    onDismiss: () -> Unit,
    /** Type in the number without a camera; no own way back to the caller, where the field lives. */
    typeInOn: () -> Unit = onDismiss,
    /** Only the overlay without a camera image — for screenshots, where there is no camera. */
    withoutCamera: Boolean = false,
) {
    val cameraPermission = rememberCameraPermission()
    val defaultHint = stringResource(R.string.scanner_hint_default)
    val detectedHintFmt = stringResource(R.string.scanner_hint_detected)
    val confirmingHint = stringResource(R.string.scanner_hint_confirming)
    var statusText by rememberSaveable { mutableStateOf(defaultHint) }
    var frozen    by rememberSaveable { mutableStateOf(false) }
    var torchOn   by rememberSaveable { mutableStateOf(false) }
    var cameraCtrl by remember { mutableStateOf<CameraControl?>(null) }
    var cameraFailed by rememberSaveable { mutableStateOf(false) }
    // Bumped by "Try again": a new key rebuilds the preview and binds the camera afresh.
    var bindAttempt by rememberSaveable { mutableIntStateOf(0) }
    // Not without a camera (screenshots), where nothing can be found anyway.
    val slow = slowScan(bindAttempt, active = !withoutCamera && cameraPermission.granted)

    LaunchedEffect(Unit) {
        if (!withoutCamera && !cameraPermission.granted) cameraPermission.requests()
    }

    // Toggle torch when state changes
    LaunchedEffect(torchOn) { cameraCtrl?.enableTorch(torchOn) }

    // No periodic focus trigger: autofocus runs via CONTINUOUS_PICTURE
    // (autofocusPermanent() in CameraSetup.kt); a tick would keep making the camera
    // re-pump. Manual focus only happens on tap.

    // The hit is also felt: whoever aims at the box isn't looking at the phone.
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current

    // A hit freezes the display; whatever is recognized afterward no longer counts.
    fun found(value: String, next: (String) -> Unit) {
        if (frozen) return
        frozen = true
        haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.Confirm)
        statusText = detectedHintFmt.replace("%1\$s", value)
        next(value)
    }

    val borderColor by animateColorAsState(
        if (frozen) LocalStatusColors.current.success else MaterialTheme.colorScheme.primary,
        label = "border"
    )

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            withoutCamera || cameraPermission.granted -> {
                if (!withoutCamera && !cameraFailed) key(bindAttempt) {
                    CameraPreviewBarcode(
                        frozen = frozen,
                        ocrEnabled = ocrEnabled,
                        onBarcodeFound = { found(it, onResult) },
                        // Separate return path: what arrives here is already the set number and must not
                        // run through EAN resolution like one — that would fail and cost quota.
                        onSetNumberFound = { found(it, onSetNumberResult) },
                        onStatus   = { if (!frozen) statusText = it },
                        onCamera   = { cameraCtrl = it },
                        onCameraError = { cameraFailed = true },
                    )
                }

                ScannerOverlay(
                    hint = scannerHint(frozen, cameraFailed, slow, statusText == confirmingHint),
                    statusText = statusText, borderColor = borderColor, torchOn = torchOn,
                    onTorch = { torchOn = !torchOn },
                    onRetry = { cameraFailed = false; bindAttempt++ },
                    typeInOn = typeInOn,
                )
            }
            else -> {
                CameraPermissionHint(stringResource(R.string.scanner_camera_purpose_barcode),
                    stringResource(R.string.scanner_number_type_in), typeInOn,
                    cameraPermission.permanentDenied) { cameraPermission.allow() }
            }
        }
        // Top left like every close on a full-screen page (BackButton).
        WithTooltip(stringResource(R.string.scanner_close), Modifier.align(Alignment.TopStart)) {
            IconButton(onClick = onDismiss, modifier = Modifier.padding(Spacing.large)) {
                Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
            }
        }
    }
}

/** After this long without a hit, the scanner names light, distance and typing. */
internal const val SLOW_HINT_MS = 10_000L

/**
 * A hint that never changes stops being read: true once the camera has run [SLOW_HINT_MS]
 * without a hit. A new [attempt] (camera bound again) starts the wait anew.
 */
@Composable
private fun slowScan(attempt: Int, active: Boolean): Boolean {
    var slow by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(attempt, active) {
        slow = false
        if (!active) return@LaunchedEffect
        kotlinx.coroutines.delay(SLOW_HINT_MS)
        slow = true
    }
    return slow
}

/** Which sentence the badge under the frame shows. */
internal enum class ScannerHint { STATUS, SLOW, CAMERA_ERROR }

/**
 * A camera that does not open beats everything; a hit and an ongoing confirmation are
 * never covered by the slow-scan advice, which would read like a failure.
 */
internal fun scannerHint(frozen: Boolean, cameraFailed: Boolean, slow: Boolean, confirming: Boolean): ScannerHint = when {
    cameraFailed -> ScannerHint.CAMERA_ERROR
    frozen || confirming || !slow -> ScannerHint.STATUS
    else -> ScannerHint.SLOW
}

/**
 * Frame, badge and buttons in the shared overlay (CameraPermission.kt). Typing the number stays
 * visible the whole time, not only once the camera is refused; a failed camera offers a retry.
 */
@Composable
private fun ScannerOverlay(
    hint: ScannerHint,
    statusText: String,
    borderColor: Color,
    torchOn: Boolean,
    onTorch: () -> Unit,
    onRetry: () -> Unit,
    typeInOn: () -> Unit,
) {
    CameraOverlay(
        hint = when (hint) {
            ScannerHint.CAMERA_ERROR -> stringResource(R.string.scanner_camera_error)
            ScannerHint.SLOW -> stringResource(R.string.scanner_hint_slow)
            ScannerHint.STATUS -> statusText
        },
        bottom = {
            Spacer(Modifier.height(Spacing.large))
            if (hint == ScannerHint.CAMERA_ERROR) {
                OverlayButton(Icons.Default.Refresh, stringResource(R.string.common_retry), onRetry)
            } else LightButton(torchOn, onTorch)
            Spacer(Modifier.height(Spacing.small))
            OverlayButton(Icons.Default.Keyboard, stringResource(R.string.scanner_number_type_in), typeInOn)
        },
    ) { ScanFrame(borderColor) }
}

/** A secondary action on the camera image: the same white outline as the torch button. */
@Composable
private fun OverlayButton(icon: ImageVector, text: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        border = BorderStroke(1.dp, Color.White),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color.Black.copy(alpha = 0.72f),
            contentColor = Color.White,
        ),
    ) {
        Icon(icon, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

/** The wide rectangle with corner angles: a barcode sits sideways, not in a square. */
@Composable
private fun ScanFrame(color: Color) {
    Box(
        Modifier
            .fillMaxWidth(0.88f)
            .aspectRatio(1.8f)
            .border(2.dp, color, Shapes.field)
    ) {
        val lang = 20.dp
        val thick = 3.dp
        for (corner in listOf(Alignment.TopStart, Alignment.TopEnd, Alignment.BottomStart, Alignment.BottomEnd)) {
            Box(Modifier.size(lang, thick).align(corner).background(color))
            Box(Modifier.size(thick, lang).align(corner).background(color))
        }
    }
}

/**
 * The torch as a button with border and icon: black on a black background read as "light
 * on" like a status, not like something to tap. Opaque surfaces like the badge
 * above: on a bright subject, white on translucent white couldn't be read.
 */
@Composable
private fun LightButton(an: Boolean, toggleOn: () -> Unit) {
    OutlinedButton(
        onClick = toggleOn,
        border = BorderStroke(1.dp, Color.White),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (an) Color.White else Color.Black.copy(alpha = 0.72f),
            contentColor = if (an) Color.Black else Color.White,
        ),
    ) {
        Icon(if (an) Icons.Default.FlashlightOff else Icons.Default.FlashlightOn, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(if (an) R.string.scanner_torch_off else R.string.scanner_torch_on),
            style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Candidates for a set number from recognized text, in descending quality. An
 * instruction booklet carries many numbers (age, part count, page, year, booklet and
 * element numbers); the longest is rarely the set number.
 */

/**
 * Words that mark a number as a quantity — word-for-word the same as QUANTITY_WORD in
 * `produkttitel.ts`. `(?iu)`, because IGNORE_CASE without `u` only knows ASCII.
 */
private val QUANTITY_WORD = Regex(
    "(?iu)^\\s*(?:x\\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|" +
    "stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\\b"
)

/**
 * Digit counts in descending quality. Unknown lengths land after them.
 * Must match `QUALITY` in `Web-App/utils/produkttitel.ts`.
 */
internal val QUALITY = listOf(5, 4, 6, 7, 3)

/**
 * Three to seven digits, optionally with a leading `#` and a variant suffix. At the
 * top rather than in the function, because it runs every 700 ms in the camera loop. Word-for-word
 * the same as `pattern` in `produkttitel.ts`.
 */
private val SET_NUMBER_PATTERN = Regex("(#\\s*)?\\b(\\d{3,7})(-\\d{1,2})?\\b")

private data class SetNumberCandidate(
    val value: String,
    val withSuffix: Boolean,
    val withHash: Boolean,
    val year: Boolean,
    val quality: Int,
)

internal fun setNumberCandidates(text: String): List<String> {
    val yearLimit = java.time.Year.now().value + 1
    val found = ArrayList<SetNumberCandidate>()
    for (hits in SET_NUMBER_PATTERN.findAll(text)) {
        val digits = hits.groupValues[2]
        val suffix = hits.groupValues[3]
        // Rule 1: whatever has a quantity word after it is a part count.
        val after = text.substring(hits.range.last + 1)
        if (QUANTITY_WORD.containsMatchIn(after)) continue
        val number = digits.toIntOrNull() ?: continue
        // With a variant suffix it's no longer a year, but a
        // set number in its unambiguous spelling.
        val year = suffix.isEmpty() && digits.length == 4 && number >= 1949 && number <= yearLimit
        // Unknown length goes all the way to the back instead of the front: indexOf
        // would otherwise return -1 and the number would win everything.
        val quality = QUALITY.indexOf(digits.length).let { if (it < 0) QUALITY.size else it }
        found.add(SetNumberCandidate(digits + suffix, suffix.isNotEmpty(),
            hits.groupValues[1].isNotEmpty(), year, quality))
    }
    // sortedWith is stable, so ties keep their order from the text.
    return found.distinctBy { it.value }
        .sortedWith(
            compareByDescending<SetNumberCandidate> { it.withSuffix }
                .thenByDescending { it.withHash }
                .thenBy { it.year }
                .thenBy { it.quality }
        )
        .map { it.value }
}

@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
@Composable
internal fun CameraPreviewBarcode(
    frozen: Boolean,
    ocrEnabled: Boolean,
    onBarcodeFound: (String) -> Unit,
    /** SET NUMBER read via text recognition — needs NO EAN resolution. */
    onSetNumberFound: (String) -> Unit,
    onStatus: (String) -> Unit,
    onCamera: (CameraControl) -> Unit,
    /** The camera could not be opened (busy, hardware error). */
    onCameraError: () -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val confirmingHint = stringResource(R.string.scanner_hint_confirming)
    val aimHint = stringResource(R.string.scanner_hint_aim)
    val errorHint = stringResource(R.string.scanner_hint_error)
    // The tap listener is set in the factory block; camera control doesn't
    // exist until after binding — hence a reference that gets filled in on binding.
    val _cameraCtrl = remember { java.util.concurrent.atomic.AtomicReference<CameraControl?>(null) }

    // The analysis loop (barcode, text recognition, confirmation, throttling) lives in
    // BarcodeAnalyzer.kt.
    val imageAnalyzer = rememberBarcodeAnalyzer(
        frozen, ocrEnabled, onBarcodeFound, onSetNumberFound, onStatus,
        confirmingHint, aimHint, errorHint,
    )

    AndroidView(
        factory = { ctx ->
            val previewView = cameraPreview(ctx)
            tapToFocus(previewView) { _cameraCtrl.get() }

            // Fetch provider, build preview, bind: CameraSetup.kt. Here
            // only what concerns the scanner stays.
            cameraBind(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
                // Camera not available: the screen says why and offers to retry or type.
                atError = onCameraError,
            ) { camera ->
                onCamera(camera.cameraControl)
                // Provide camera control for the tap. Only one listener:
                // setOnTouchListener replaces it, a second would overwrite the one in the factory above.
                _cameraCtrl.set(camera.cameraControl)
            }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
