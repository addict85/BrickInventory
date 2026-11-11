package ch.brickinventoryapp.data.api

import kotlinx.serialization.json.Json

/**
 * Wie die App Antworten des Servers liest — eine Stelle für App und Tests.
 * Streng, damit eine Zahl als Text oder ein null im Pflichtfeld auffällt statt still zu 0 zu
 * werden; unbekannte Felder bleiben erlaubt, damit der Server Neues schicken darf.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
