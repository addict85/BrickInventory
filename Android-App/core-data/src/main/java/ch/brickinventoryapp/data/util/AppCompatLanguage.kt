package ch.brickinventoryapp.data.util

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import ch.brickinventoryapp.dataapi.language.AppLanguage
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Applies the saved language preference ("system", "en", "de") via
 * AppCompatDelegate.setApplicationLocales().
 * AppCompatDelegate saves the choice itself and recreates the activity; an own
 * context wrapper would be duplicate work.
 */
@Singleton
internal class AppCompatLanguage @Inject constructor() : AppLanguage {

    /** Called at app start (Application.onCreate) from the saved value. */
    override fun applyLanguage(languageCode: String) {
        val localeList = if (languageCode == "system") {
            LocaleListCompat.getEmptyLocaleList()
        } else {
            LocaleListCompat.forLanguageTags(languageCode)
        }
        // If the selection does not change, do not trigger an unnecessary recreation
        if (AppCompatDelegate.getApplicationLocales() != localeList) {
            AppCompatDelegate.setApplicationLocales(localeList)
        }
    }

    /**
     * Context with the chosen app language — for SERVICES and other
     * non-activity contexts.
     * setApplicationLocales() only localizes activities; a service would otherwise get the
     * system language below Android 13.
     */
    // The app bundle does not split the languages (build.gradle.kts, bundle.language),
    // and the APK is distributed anyway: all texts are always on board.
    @Suppress("AppBundleLocaleChanges")
    override fun localizedContext(base: android.content.Context): android.content.Context {
        if (android.os.Build.VERSION.SDK_INT >= 33) return base
        val locales = AppCompatDelegate.getApplicationLocales()
        if (locales.isEmpty) return base
        val config = android.content.res.Configuration(base.resources.configuration)
        config.setLocale(locales[0])
        return base.createConfigurationContext(config)
    }
}
