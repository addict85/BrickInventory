package ch.brickinventoryapp.data.api

import kotlinx.serialization.json.Json

/**
 * Wie die App Antworten des Servers liest — eine Stelle für App und Tests.
 *
 * Streng: Eine Zahl als Text oder ein null in einem Pflichtfeld ist ein
 * Fehler und wird nicht still zu 0 oder false. Die Modelle prüft die Web-App
 * gegen den Vertrag des Servers (vertrag-kotlin), den Server gegen den Vertrag
 * vertrag-lesen-db und vertrag-schreiben-db.
 * Unbekannte Felder bleiben erlaubt: Der Server darf Neues schicken, bevor
 * die App es kennt.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
