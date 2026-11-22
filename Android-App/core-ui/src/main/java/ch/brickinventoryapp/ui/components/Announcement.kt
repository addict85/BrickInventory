package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay

/**
 * A status message for TalkBack only, without a surface of its own: it sits next to the
 * visible text when that lives in a button or field that would otherwise become a live
 * region as a whole and announce every change.
 */
@Composable
fun Announcement(text: String?, modifier: Modifier = Modifier) {
    Box(modifier.announce().semantics { if (text != null) contentDescription = text })
}

/**
 * Like [Announcement], but at most a new wording every [gapMs]: a countdown
 * announced every second would drown out everything else.
 */
@Composable
fun ThrottledAnnouncement(text: String, gapMs: Long = ANNOUNCEMENT_GAP_MS) {
    val current by rememberUpdatedState(text)
    var announcementProgress by remember { mutableStateOf(text) }
    LaunchedEffect(gapMs) {
        while (true) {
            delay(gapMs)
            announcementProgress = current
        }
    }
    Announcement(announcementProgress)
}

/** Zehn Sekunden zwischen zwei Ansagen eines laufenden Vorgangs. */
const val ANNOUNCEMENT_GAP_MS = 10_000L
