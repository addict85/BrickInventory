package ch.brickinventoryapp.ui.util

import android.os.Build
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Die Android-Stufe, nach der die Oberfläche Schutz auswählt. Als Wert der
 * Komposition statt Build.VERSION.SDK_INT im Bildschirm: Robolectric läuft hier
 * nur gegen API 35, und die Zweige für ältere Geräte sollen trotzdem geprüft sein.
 */
val LocalSdkStufe = staticCompositionLocalOf { Build.VERSION.SDK_INT }
