package ch.brickinventoryapp.model.json

import kotlinx.serialization.json.Json

/**
 * Die eine Json-Konfiguration der App für Server, Ablage und Cache; die Datenschicht reicht
 * sie per DI weiter. Unbekannte Felder sind erlaubt, damit der Server Neues schicken darf und
 * eine ältere Ablage lesbar bleibt. Vorgaben werden geschrieben: Was abgelegt ist, hängt so
 * nicht an den Vorgabewerten der Fassung, die es liest.
 */
val BrickJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
