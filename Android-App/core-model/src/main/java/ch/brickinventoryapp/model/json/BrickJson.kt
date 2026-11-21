package ch.brickinventoryapp.model.json

import kotlinx.serialization.json.Json

/**
 * The one Json configuration of the app for server, store and cache; the data layer passes
 * it on via DI. Unknown fields are allowed, so that the server may send new things and
 * an older store stays readable. Defaults are written: what is stored thus does not hang
 * on the default values of the version that reads it.
 */
val BrickJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}
