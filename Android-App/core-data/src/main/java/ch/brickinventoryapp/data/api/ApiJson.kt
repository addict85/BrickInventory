package ch.brickinventoryapp.data.api

import kotlinx.serialization.json.Json

/**
 * Wie die App Antworten des Servers liest — eine Stelle für App und Tests.
 * Ausführlich: docs/begruendungen/core-data/data/api/ApiJson.kt.md#apijson
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
