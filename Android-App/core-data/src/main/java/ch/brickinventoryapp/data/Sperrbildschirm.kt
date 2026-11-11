package ch.brickinventoryapp.data

import android.content.Context
import androidx.core.app.NotificationCompat

/**
 * Auf dem gesperrten Bildschirm nur der Titel: Texte nennen Server, Dateien oder
 * Fortschritt des Kontos, und das Telefon liegt oft offen herum. Entsperrt gilt
 * die volle Meldung (wie PreisalarmWorker.meldung). Öffentlich, weil der PDF-Dienst
 * in core-dienste dieselbe Regel braucht.
 */
fun NotificationCompat.Builder.nurEntsperrt(context: Context, kanal: String, titel: String, symbol: Int): NotificationCompat.Builder =
    setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(
            NotificationCompat.Builder(context, kanal).setSmallIcon(symbol).setContentTitle(titel).build(),
        )
