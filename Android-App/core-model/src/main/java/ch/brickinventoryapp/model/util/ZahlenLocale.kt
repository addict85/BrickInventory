package ch.brickinventoryapp.model.util

import java.util.Locale

/**
 * Like the web: the device's country form if it matches the app language
 * (de-DE writes 4.894,77, de-CH 4’894.77), otherwise de-CH or en-GB. In core-model,
 * because the price alert notification in the background (core-services) also formats without UI.
 */
fun numbersLocale(sprache: Locale, geraet: Locale): Locale {
    val ziel = if (sprache.language == "de") "de" else "en"
    val land = sprache.country.takeIf { sprache.language == ziel && it.length == 2 }
        ?: geraet.country.takeIf { geraet.language == ziel && it.length == 2 }
    return Locale.forLanguageTag(if (land != null) "$ziel-$land" else if (ziel == "de") "de-CH" else "en-GB")
}
