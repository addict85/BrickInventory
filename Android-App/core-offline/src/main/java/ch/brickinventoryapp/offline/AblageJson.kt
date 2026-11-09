package ch.brickinventoryapp.offline

import kotlinx.serialization.json.Json

/**
 * Wie Listen und Bearbeitungen lokal als JSON liegen. Dieselben Einstellungen wie
 * ApiJson in core-data: Was eine frühere Fassung abgelegt hat, muss lesbar bleiben,
 * und ein Feld, das der Server neu liefert, darf das Lesen nicht brechen.
 */
internal val AblageJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
