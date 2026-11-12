package ch.brickinventoryapp.model.util

import java.util.Locale

/**
 * Wie das Web: die Landesform des Geräts, wenn sie zur App-Sprache passt
 * (de-DE schreibt 4.894,77, de-CH 4’894.77), sonst de-CH bzw. en-GB. In core-model,
 * weil auch die Preisalarm-Meldung im Hintergrund (core-dienste) ohne Oberfläche formatiert.
 */
fun zahlenLocale(sprache: Locale, geraet: Locale): Locale {
    val ziel = if (sprache.language == "de") "de" else "en"
    val land = sprache.country.takeIf { sprache.language == ziel && it.length == 2 }
        ?: geraet.country.takeIf { geraet.language == ziel && it.length == 2 }
    return Locale.forLanguageTag(if (land != null) "$ziel-$land" else if (ziel == "de") "de-CH" else "en-GB")
}
