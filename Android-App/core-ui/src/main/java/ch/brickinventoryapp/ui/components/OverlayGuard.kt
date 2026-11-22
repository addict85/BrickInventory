package ch.brickinventoryapp.ui.components

import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.resources.R

/**
 * Discards touches as long as a foreign window sits on top (tapjacking; from Android 12
 * the system blocks this itself, Android 11 is affected).
 */
@Composable
fun OverlayGuard() {
    val view = LocalView.current
    DisposableEffect(view) {
        val ownWindow = (view.parent as? DialogWindowProvider)?.window
        val target = ownWindow?.decorView ?: view.rootView
        val window = ownWindow ?: activityWindow(view.context)
        fun count() = target.getTag(R.id.overlay_count) as? Int ?: 0
        target.setTag(R.id.overlay_count, count() + 1)
        target.filterTouchesWhenObscured = true
        window?.let(PartialHiddenFilter::attachTo)
        onDispose {
            val rest = count() - 1
            target.setTag(R.id.overlay_count, rest)
            if (rest <= 0) target.filterTouchesWhenObscured = false
            if (rest <= 0) window?.let(PartialHiddenFilter::remove)
        }
    }
}

private fun activityWindow(context: android.content.Context): Window? =
    generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .filterIsInstance<android.app.Activity>().firstOrNull()?.window

/**
 * filterTouchesWhenObscured only applies when the foreign window sits exactly over the
 * tap. If it sits next to it (FLAG_WINDOW_IS_PARTIALLY_OBSCURED),
 * it can cover or fake text while the tap goes through — that's why
 * it's discarded here for the whole window. An ongoing gesture ends with
 * ACTION_CANCEL, so no button stays stuck down.
 */
internal class PartialHiddenFilter(val old: Window.Callback) : Window.Callback by old {

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!partialHidden(event)) return old.dispatchTouchEvent(event)
        if (event.actionMasked != MotionEvent.ACTION_DOWN) {
            val abort = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            old.dispatchTouchEvent(abort)
            abort.recycle()
        }
        return true
    }

    // `by` doesn't forward the interface's default methods.
    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) =
        old.onProvideKeyboardShortcuts(data, menu, deviceId)

    override fun onPointerCaptureChanged(hasCapture: Boolean) = old.onPointerCaptureChanged(hasCapture)

    companion object {
        fun attachTo(window: Window) {
            val now = window.callback ?: return
            if (now !is PartialHiddenFilter) window.callback = PartialHiddenFilter(now)
        }

        fun remove(window: Window) {
            (window.callback as? PartialHiddenFilter)?.let { window.callback = it.old }
        }
    }
}

internal fun partialHidden(event: MotionEvent): Boolean =
    (event.flags and MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0
