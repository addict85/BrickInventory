package ch.brickinventoryapp.contract.testing

import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer

// A test server's response names only what the test checks; the required fields it leaves out
// get empty values here, as testX() does for constructed responses. The app itself reads strictly
// (no defaults for required fields); StrictResponseTest in core-contract checks that.

/** [text] read as [serializer] after [completed]: a test response that names only what it checks. */
fun <T> decodeCompleted(serializer: KSerializer<T>, text: String): T =
    BrickJson.decodeFromJsonElement(serializer, completed(BrickJson.parseToJsonElement(text), serializer.descriptor))

inline fun <reified T> decodeCompleted(text: String): T = decodeCompleted(serializer<T>(), text)

/** [element] with every missing required field of [d] filled with its empty value, at any depth. */
@OptIn(ExperimentalSerializationApi::class)
fun completed(element: JsonElement, d: SerialDescriptor): JsonElement = when {
    d.isInline -> completed(element, d.getElementDescriptor(0))
    element is JsonObject && d.kind == StructureKind.CLASS -> JsonObject(buildMap {
        for (i in 0 until d.elementsCount) {
            val name = d.getElementName(i)
            val value = element[name]
            when {
                value != null -> put(name, completed(value, d.getElementDescriptor(i)))
                !d.isElementOptional(i) -> put(name, empty(d.getElementDescriptor(i)))
            }
        }
        for ((name, value) in element) if (name !in this) put(name, value)
    })
    element is JsonArray && d.kind == StructureKind.LIST -> JsonArray(element.map { completed(it, d.getElementDescriptor(0)) })
    element is JsonObject && d.kind == StructureKind.MAP ->
        JsonObject(element.mapValues { (_, v) -> completed(v, d.getElementDescriptor(1)) })
    else -> element
}

@OptIn(ExperimentalSerializationApi::class)
private fun empty(d: SerialDescriptor): JsonElement = when {
    d.isNullable -> JsonNull
    d.isInline -> empty(d.getElementDescriptor(0))
    else -> when (d.kind) {
        PrimitiveKind.STRING, PrimitiveKind.CHAR -> JsonPrimitive("")
        PrimitiveKind.BOOLEAN -> JsonPrimitive(false)
        PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE -> JsonPrimitive(0)
        PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT -> JsonPrimitive(0.0)
        SerialKind.ENUM -> JsonPrimitive(d.getElementName(0))
        StructureKind.LIST -> JsonArray(emptyList())
        StructureKind.MAP -> JsonObject(emptyMap())
        StructureKind.CLASS -> completed(JsonObject(emptyMap()), d)
        is PolymorphicKind, SerialKind.CONTEXTUAL, StructureKind.OBJECT -> JsonNull
    }
}
