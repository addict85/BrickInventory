package ch.brickinventoryapp.data.api

import kotlinx.serialization.json.Json

/**
 * Wie die App Antworten des Servers liest — eine Stelle für App und Tests.
 *
 * Streng: Eine Zahl als Text oder ein null in einem Pflichtfeld ist ein
 * Fehler und wird nicht still zu 0 oder false. Dass der Server sich daran
 * hält, prüfen in der Web-App api-vertrag-kotlin-db (GET) und
 * api-vertrag-schreiben-db (POST/PUT/DELETE) gegen diese Modelle.
 * Unbekannte Felder bleiben erlaubt: Der Server darf Neues schicken, bevor
 * die App es kennt.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
