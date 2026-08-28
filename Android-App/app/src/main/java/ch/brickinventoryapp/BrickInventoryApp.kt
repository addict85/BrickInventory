package ch.brickinventoryapp

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.flow.first

@HiltAndroidApp
class BrickInventoryApp : Application() {
    @Inject lateinit var preferencesManager: ch.brickinventoryapp.data.PreferencesManager

    override fun onCreate() {
        super.onCreate()
        // Ab Android 13 (API 33) persistiert das System die per-App-Sprache
        // selbst (LocaleManager) und wendet sie vor Activity-Start an — der
        // blockierende DataStore-Read beim Kaltstart ist dort unnötig.
        // Nur auf älteren Geräten muss die gespeicherte Sprache manuell
        // re-appliziert werden, bevor die erste Activity rendert.
        if (android.os.Build.VERSION.SDK_INT < 33) {
            kotlinx.coroutines.runBlocking {
                val lang = preferencesManager.language.first()
                ch.brickinventoryapp.util.LanguageManager.applyLanguage(lang)
            }
        }
    }
}

