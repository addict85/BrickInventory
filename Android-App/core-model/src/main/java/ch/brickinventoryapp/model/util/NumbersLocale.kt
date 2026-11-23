package ch.brickinventoryapp.model.util

import java.util.Locale

/**
 * Like the web: the device's country form if it matches the app language
 * (de-DE writes 4.894,77, de-CH 4’894.77), otherwise de-CH or en-GB. In core-model,
 * because the price alert notification in the background (core-services) also formats without UI.
 */
fun numbersLocale(language: Locale, device: Locale): Locale {
    val target = if (language.language == "de") "de" else "en"
    val land = language.country.takeIf { language.language == target && it.length == 2 }
        ?: device.country.takeIf { device.language == target && it.length == 2 }
    return Locale.forLanguageTag(if (land != null) "$target-$land" else if (target == "de") "de-CH" else "en-GB")
}
