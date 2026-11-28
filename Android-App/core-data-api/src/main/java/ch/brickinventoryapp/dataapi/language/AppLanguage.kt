package ch.brickinventoryapp.dataapi.language

import android.content.Context

/**
 * The app's own language ("system", "en", "de"), apart from the system's. Injected rather than a
 * global object, so a worker, a ViewModel or a test names it as a dependency instead of reaching
 * into static state.
 */
interface AppLanguage {
    /** Applies the saved preference; called at start (Application) and when the user changes it. */
    fun applyLanguage(languageCode: String)

    /**
     * [base] in the chosen app language, for services and other non-activity contexts: below
     * Android 13 they otherwise speak the system language.
     */
    fun localizedContext(base: Context): Context
}
