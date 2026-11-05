package ch.brickinventoryapp.util

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/**
 * Wendet die gespeicherte Sprachpräferenz ("system", "en", "de") über
 * AppCompatDelegate.setApplicationLocales() an.
 * Ausführlich: docs/begruendungen/core-data/util/LanguageManager.kt.md#languagemanager
 */
object LanguageManager {

    /** Wird beim App-Start (Application.onCreate) aus dem gespeicherten Wert aufgerufen. */
    fun applyLanguage(languageCode: String) {
        val localeList = if (languageCode == "system") {
            LocaleListCompat.getEmptyLocaleList()
        } else {
            LocaleListCompat.forLanguageTags(languageCode)
        }
        // Wenn sich die Auswahl nicht ändert, keine unnötige Recreation auslösen
        if (AppCompatDelegate.getApplicationLocales() != localeList) {
            AppCompatDelegate.setApplicationLocales(localeList)
        }
    }

    /**
     * Context mit der gewählten App-Sprache — für SERVICES und andere
     * Nicht-Activity-Kontexte.
     * Ausführlich: docs/begruendungen/core-data/util/LanguageManager.kt.md#nicht
     */
    // Das App-Bundle trennt die Sprachen nicht (build.gradle.kts, bundle.language),
    // und verteilt wird ohnehin das APK: Alle Texte sind immer an Bord.
    @Suppress("AppBundleLocaleChanges")
    fun localizedContext(base: android.content.Context): android.content.Context {
        if (android.os.Build.VERSION.SDK_INT >= 33) return base
        val locales = AppCompatDelegate.getApplicationLocales()
        if (locales.isEmpty) return base
        val config = android.content.res.Configuration(base.resources.configuration)
        config.setLocale(locales[0])
        return base.createConfigurationContext(config)
    }
}
