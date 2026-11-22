package ch.brickinventoryapp.data

import android.content.Context
import androidx.core.app.NotificationCompat

/**
 * On the lock screen only the title: texts name server, files or
 * progress of the account, and the phone often lies around openly. Unlocked
 * the full notification applies (like PriceAlarmWorker.meldung). Public because the PDF service
 * in core-services needs the same rule.
 */
fun NotificationCompat.Builder.onlyUnlocked(context: Context, channel: String, title: String, symbol: Int): NotificationCompat.Builder =
    setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(
            NotificationCompat.Builder(context, channel).setSmallIcon(symbol).setContentTitle(title).build(),
        )
