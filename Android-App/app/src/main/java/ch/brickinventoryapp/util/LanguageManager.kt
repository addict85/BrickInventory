package ch.brickinventoryapp.util

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/**
 * Wendet die gespeicherte Sprachpräferenz ("system", "en", "de") über
 * AppCompatDelegate.setApplicationLocales() an.
 *
 * Vorteil gegenüber manuellem Context-Wrapping: AppCompatDelegate kümmert
 * sich intern um die Persistenz (über AppLocalesMetadataHolderService bzw.
 * ab Android 13 über die System-LocaleManager-API) und um den Recreate()
 * der laufenden Activity — man muss nichts selbst speichern oder die
 * Activity manuell neu erzeugen.
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
     *
     * AppCompatDelegate.setApplicationLocales() lokalisiert nur
     * AppCompat-Activities. Ein Service, der auf seinem eigenen Context
     * getString() aufruft, bekommt unterhalb von Android 13 weiterhin die
     * SYSTEM-Sprache — genau deshalb waren die Benachrichtigungstexte der
     * Foreground-Services bisher hartkodiert statt lokalisiert. Ab Android 13
     * wendet das System die per-App-Sprache selbst auf den ganzen Prozess an,
     * dort ist der Context unverändert richtig.
     */
    fun localizedContext(base: android.content.Context): android.content.Context {
        if (android.os.Build.VERSION.SDK_INT >= 33) return base
        val locales = AppCompatDelegate.getApplicationLocales()
        if (locales.isEmpty) return base
        val config = android.content.res.Configuration(base.resources.configuration)
        config.setLocale(locales[0])
        return base.createConfigurationContext(config)
    }
}
